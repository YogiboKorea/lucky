require('dotenv').config(); // .env 파일의 변수를 로드합니다.
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const ExcelJS = require('exceljs'); // Excel 파일 생성을 위한 라이브러리

const app = express();
const port = process.env.PORT || 3100;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uri = process.env.MONGODB_URI;  // .env 파일에 정의한 MONGODB_URI 사용
const client = new MongoClient(uri, { useUnifiedTopology: true });

client.connect()
  .then(() => {
    console.log('MongoDB 연결 성공');
    // 데이터베이스 이름이 .env에 포함되어 있지 않으면 명시적으로 지정합니다.
    const db = client.db('yogibo'); 
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

        // 참여 기록 삽입
        const newEntry = {
          memberId: memberId,
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

    // GET /api/entry/download: 참여 데이터를 Excel 파일로 다운로드하는 엔드포인트
    app.get('/api/lucky/download', async (req, res) => {
      try {
        // 모든 참여 데이터를 가져옵니다.
        const entries = await entriesCollection.find({}).toArray();

        // 새로운 워크북과 워크시트를 생성합니다.
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Entries');

        // 워크시트에 헤더 행을 추가합니다.
        worksheet.columns = [
          
          { header: '참여 날짜', key: 'createdAt', width: 30 },
          { header: '회원아이디', key: 'memberId', width: 20 }
        ];

        // 각 참여 데이터를 행으로 추가합니다.
        entries.forEach(entry => {
          worksheet.addRow({
            memberId: entry.memberId,
            createdAt: entry.createdAt  // 필요에 따라 날짜 포맷팅 가능
          });
        });

        // 응답 헤더를 설정하여 Excel 파일로 다운로드되도록 합니다.
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=entries.xlsx');

        // 워크북을 응답 스트림으로 작성합니다.
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
