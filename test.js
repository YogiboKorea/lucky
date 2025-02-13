require('dotenv').config(); // 최상단에 추가하여 .env 파일의 변수를 로드합니다.
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

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
    // 만약 .env의 MONGODB_URI에 DB 이름이 포함되어 있지 않다면,
    // client.db('yourdbname')와 같이 DB 이름을 명시해주어야 합니다.
    const db = client.db('yogibo'); 
    const entriesCollection = db.collection('entries');

    app.post('/api/entry', async (req, res) => {
      const { memberId } = req.body;
      if (!memberId) {
        return res.status(400).json({ error: 'memberId 값이 필요합니다.' });
      }
      try {
        // memberId가 이미 존재하는지 확인 (한 번만 참여 가능)
        const existingEntry = await entriesCollection.findOne({ memberId });
        if (existingEntry) {
          return res.status(409).json({ message: '이미 참여하셨습니다.' });
        }
        
        // 참여 기록이 없으면 새로 삽입
        const newEntry = {
          memberId: memberId,
          createdAt: new Date()
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

    app.listen(port, () => {
      console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
    });
  })
  .catch(err => {
    console.error('MongoDB 연결 실패:', err);
    process.exit(1);
  });

  