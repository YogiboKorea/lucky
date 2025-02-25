require('dotenv').config(); // .env 파일의 변수를 로드합니다.
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const ExcelJS = require('exceljs'); // Excel 파일 생성을 위한 라이브러리
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== 환경 변수 및 전역 변수 설정 =====
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const tokenCollectionName = process.env.TOKEN_COLLECTION_NAME || 'tokens';
const clientId = process.env.CAFE24_CLIENT_ID;
const clientSecret = process.env.CAFE24_CLIENT_SECRET;
const MALLID = process.env.CAFE24_MALLID || 'yogibo';

// 초기 토큰 값은 process.env에서 가져오지 않고 null로 설정하여 MongoDB에서 무조건 불러오도록 함.
let accessToken = null;
let refreshToken = null;

/**
 * MongoDB에서 토큰을 조회합니다.
 */
async function getTokensFromDB() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(tokenCollectionName);
    const tokens = await collection.findOne({ name: 'cafe24Tokens' });
    if (tokens) {
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      console.log('MongoDB에서 토큰 로드 성공:', tokens);
    } else {
      console.log('MongoDB에 저장된 토큰이 없습니다.');
    }
  } catch (error) {
    console.error('토큰 로드 중 오류:', error);
  } finally {
    await client.close();
  }
}

/**
 * MongoDB에 토큰을 저장합니다.
 */
async function saveTokensToDB(newAccessToken, newRefreshToken) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(tokenCollectionName);
    await collection.updateOne(
      { name: 'cafe24Tokens' },
      {
        $set: {
          name: 'cafe24Tokens',
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    console.log('MongoDB에 토큰 저장 완료');
  } catch (error) {
    console.error('토큰 저장 중 오류:', error);
  } finally {
    await client.close();
  }
}

/**
 * Access Token 및 Refresh Token 갱신 함수
 * 토큰이 만료된 경우 refreshAccessToken을 호출하고, 새 토큰을 MongoDB에 저장합니다.
 */
async function refreshAccessToken() {
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post(
      `https://${MALLID}.cafe24api.com/api/v2/oauth/token`,
      `grant_type=refresh_token&refresh_token=${refreshToken}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
      }
    );
    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;
    console.log('Access Token 갱신 성공:', newAccessToken);
    console.log('Refresh Token 갱신 성공:', newRefreshToken);
    // 갱신된 토큰을 MongoDB에 저장
    await saveTokensToDB(newAccessToken, newRefreshToken);
    accessToken = newAccessToken;
    refreshToken = newRefreshToken;
    return newAccessToken;
  } catch (error) {
    if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
      console.error('Refresh Token이 만료되었습니다. 인증 단계를 다시 수행해야 합니다.');
    } else {
      console.error('Access Token 갱신 실패:', error.response ? error.response.data : error.message);
    }
    throw error;
  }
}

/**
 * API 요청 함수 (자동 토큰 갱신 포함)
 * API 요청 시 accessToken을 사용하다가 401 에러 발생하면 refreshAccessToken을 호출하여 재시도합니다.
 */
async function apiRequest(method, url, data = {}, params = {}) {
  try {
    const response = await axios({
      method,
      url,
      data,
      params,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('Access Token 만료. 갱신 중...');
      await refreshAccessToken();
      return apiRequest(method, url, data, params);
    } else {
      console.error('API 요청 오류:', error.response ? error.response.data : error.message);
      throw error;
    }
  }
}

/**
 * 예시: member_id를 기반으로 고객 데이터를 가져오기
 */
async function getCustomerDataByMemberId(memberId) {
  // 무조건 MongoDB에서 토큰을 로드하여 사용
  await getTokensFromDB();
  const url = `https://${MALLID}.cafe24api.com/api/v2/admin/customersprivacy`;
  const params = { member_id: memberId };
  try {
    const data = await apiRequest('GET', url, {}, params);
    console.log('Customer Data:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`Error fetching customer data for member_id ${memberId}:`, error);
    throw error;
  }
}

// MongoDB 연결 및 Express 서버 설정 (이벤트 참여 데이터 저장)
const clientInstance = new MongoClient(mongoUri, { useUnifiedTopology: true });
clientInstance.connect()
  .then(() => {
    console.log('MongoDB 연결 성공');
    const db = clientInstance.db(dbName);
    const entriesCollection = db.collection('entries');
    
    // 참여자 수 반환 라우트 (entriesCollection 사용)
    app.get('/api/entry/count', async (req, res) => {
      try {
        const count = await entriesCollection.countDocuments();
        res.json({ count });
      } catch (error) {
        console.error('참여자 수 가져오기 오류:', error);
        res.status(500).json({ error: '서버 내부 오류' });
      }
    });
    
    app.post('/api/entry', async (req, res) => {
      const { memberId } = req.body;
      if (!memberId) {
        return res.status(400).json({ error: 'memberId 값이 필요합니다.' });
      }
      try {
        // 고객 데이터 가져오기 (권한 부여 포함)
        const customerData = await getCustomerDataByMemberId(memberId);
        if (!customerData || !customerData.customersprivacy) {
          return res.status(404).json({ error: '고객 데이터를 찾을 수 없습니다.' });
        }
        
        // customersprivacy가 배열인 경우 첫 번째 항목 선택
        let customerPrivacy = customerData.customersprivacy;
        if (Array.isArray(customerPrivacy)) {
          customerPrivacy = customerPrivacy[0];
        }
        
        // 필요한 필드 추출: member_id, name, cellphone, email, address1, address2, sms, gender
        const { member_id, name, cellphone, email, address1, address2, sms, gender } = customerPrivacy;
        
        // 중복 참여 확인
        const existingEntry = await entriesCollection.findOne({ memberId: member_id });
        if (existingEntry) {
          return res.status(409).json({ message: '이미 참여하셨습니다.' });
        }
        
        // 한국 시간 기준 날짜 생성
        const createdAtKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        
        // 저장할 객체 생성 (address1과 address2 모두 저장, 고객 성함(name) 추가)
        const newEntry = {
          memberId: member_id,
          name,
          cellphone,
          email,
          address1,
          address2,
          sms,
          gender,
          createdAt: createdAtKST
        };
    
        const result = await entriesCollection.insertOne(newEntry);
        res.json({
          message: '이벤트 응모 완료 되었습니다.',
          entry: newEntry,
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error('회원 정보 저장 오류:', error);
        res.status(500).json({ error: '서버 내부 오류' });
      }
    });
    
    app.get('/api/lucky/download', async (req, res) => {
      try {
        const entries = await entriesCollection.find({}).toArray();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Entries');
        worksheet.columns = [
          { header: '참여 날짜', key: 'createdAt', width: 30 },
          { header: '회원아이디', key: 'memberId', width: 20 },
          { header: '회원 성함', key: 'name', width: 20 },
          { header: '휴대폰 번호', key: 'cellphone', width: 20 },
          { header: '이메일', key: 'email', width: 30 },
          { header: '주소', key: 'fullAddress', width: 50 },
          { header: 'SNS 수신여부', key: 'sms', width: 15 },
          { header: '성별', key: 'gender', width: 10 },
        ];
        
        entries.forEach(entry => {
          // address1과 address2 합치기 (address2가 있을 경우)
          const fullAddress = entry.address1 + (entry.address2 ? ' ' + entry.address2 : '');
          worksheet.addRow({
            createdAt: entry.createdAt,
            memberId: entry.memberId,
            name: entry.name,
            cellphone: entry.cellphone,
            email: entry.email,
            fullAddress: fullAddress,
            sms: entry.sms,
            gender: entry.gender,
          });
        });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=luckyEvent.xlsx');
        await workbook.xlsx.write(res);
        res.end();
      } catch (error) {
        console.error('Excel 다운로드 오류:', error);
        res.status(500).json({ error: 'Excel 다운로드 중 오류 발생' });
      }
    });
    
    app.listen(port, () => {
      console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
    });
  })
  .catch(err => {
    console.error('MongoDB 연결 실패:', err);
    process.exit(1);
  });
