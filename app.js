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
const MALLID = process.env.CAFE24_MALLID;

// 초기 토큰 값 (없으면 null)
let accessToken ='p9KvyKOeOCxX5VWxx7KE9C'
let refreshToken = 'MeswNPrIKi5TD38sioOm7H'

// ===== 토큰 관리 함수 =====

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
            console.log('MongoDB에 저장된 토큰이 없습니다. 초기값 사용');
        }
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
    } finally {
        await client.close();
    }
}

/**
 * Access Token 및 Refresh Token 갱신 함수
 */
async function refreshAccessToken() {
    try {
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await axios.post(
            `https://yogibo.cafe24api.com/api/v2/oauth/token`,
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
        await saveTokensToDB(newAccessToken, newRefreshToken);
        accessToken = newAccessToken;
        refreshToken = newRefreshToken;
        return newAccessToken;
    } catch (error) {
        if (error.response?.data?.error === 'invalid_grant') {
            console.error('Refresh Token이 만료되었습니다. 인증 단계를 다시 수행해야 합니다.');
        } else {
            console.error('Access Token 갱신 실패:', error.response ? error.response.data : error.message);
        }
        throw error;
    }
}

/**
 * API 요청 함수 (자동 토큰 갱신 포함)
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
        if (error.response?.status === 401) {
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
 * 예시: member_id를 기반으로 고객 데이터 가져오기
 */
async function getCustomerDataByMemberId(memberId) {
  const url = `https://${MALLID}.cafe24api.com/api/v2/admin/customers`;
  const params = { member_id: memberId }; // 또는 cellphone: '01012345678'
  try {
      const data = await apiRequest('GET', url, {}, params);
      // 전체 데이터를 가독성 있게 출력합니다.
      console.log('Customer Data:', JSON.stringify(data, null, 2));
      return data;
  } catch (error) {
      console.error(`Error fetching customer data for member_id ${memberId}:`, error);
      throw error;
  }
}
// ===== 이벤트 참여 및 Excel 다운로드 관련 기능 =====

// MongoDB 클라이언트 for 이벤트 참여 데이터 (같은 DB 사용)
const eventClient = new MongoClient(mongoUri, { useUnifiedTopology: true });
eventClient.connect()
  .then(() => {
    console.log('MongoDB 연결 성공 (Event Participation)');
    const db = eventClient.db(dbName);
    const entriesCollection = db.collection('entries');

    // POST /api/entry: 참여 데이터를 저장하는 엔드포인트
    app.post('/api/entry', async (req, res) => {
      const { memberId } = req.body;
      if (!memberId) {
        return res.status(400).json({ error: 'memberId 값이 필요합니다.' });
      }
      try {
        // 중복 참여 확인: 동일한 memberId가 이미 존재하면 409 응답
        const existingEntry = await entriesCollection.findOne({ memberId });
        if (existingEntry) {
          return res.status(409).json({ message: '이미 참여하셨습니다.' });
        }
        
        // 한국 시간 기준으로 날짜 생성
        const createdAtKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const newEntry = {
          memberId,
          createdAt: createdAtKST
        };
        const result = await entriesCollection.insertOne(newEntry);
        res.json({
          message: '이벤트 응모 완료 되었습니다.',
          entry: newEntry,
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error('회원 아이디 저장 오류:', error);
        res.status(500).json({ error: '서버 내부 오류' });
      }
    });

    // GET /api/entry/count: 총 참여자 수 반환 엔드포인트
    app.get('/api/entry/count', async (req, res) => {
      try {
        const count = await entriesCollection.countDocuments();
        res.json({ count });
      } catch (error) {
        console.error('참여자 수 가져오기 오류:', error);
        res.status(500).json({ error: '서버 내부 오류' });
      }
    });

    // GET /api/lucky/download: 참여 데이터를 Excel 파일로 다운로드하는 엔드포인트
    app.get('/api/lucky/download', async (req, res) => {
      try {
        const entries = await entriesCollection.find({}).toArray();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('럭키드로우 참여인원');
        worksheet.columns = [
          { header: '참여날짜', key: 'createdAt', width: 30 },
          { header: '회원아이디', key: 'memberId', width: 20 },
          { header: '휴대폰번호', key: 'cellphone', width: 20 }
        ];
        entries.forEach(entry => {
          worksheet.addRow({
            memberId: entry.memberId,
            createdAt: entry.createdAt,
            cellphone: entry.cellphone
          });
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=entries.xlsx');
        await workbook.xlsx.write(res);
        res.end();
      } catch (error) {
        console.error('Excel 다운로드 오류:', error);
        res.status(500).json({ error: 'Excel 다운로드 중 오류 발생' });
      }
    });

    // GET /api/customer: 고객 데이터 조회 엔드포인트 (쿼리 파라미터: member_id)
    app.get('/api/customer', async (req, res) => {
      const memberId = req.query.member_id;
      if (!memberId) {
        return res.status(400).json({ error: 'member_id query parameter is required' });
      }
      try {
        const customerData = await getCustomerDataByMemberId(memberId);
        res.json(customerData);
      } catch (error) {
        res.status(500).json({ error: '고객 데이터 조회 중 오류 발생' });
      }
    });

    app.listen(port, () => {
      console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
    });
  })
  .catch(err => {
    console.error('MongoDB 연결 실패 (Event Participation):', err);
    process.exit(1);
  });
