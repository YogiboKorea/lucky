require('dotenv').config(); // 최상단에 추가하여 .env 파일의 변수를 로드합니다.
const express = require('express');
const { MongoClient } = require('mongodb');
const app = express();
const port = process.env.PORT || 3100;
const cors = require('cors');
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uri = process.env.MONGODB_URI;  // .env 파일에 정의한 MONGODB_URI 사용
const client = new MongoClient(uri, { useUnifiedTopology: true });

client.connect()
  .then(() => {
    console.log('MongoDB 연결 성공');
    const db = client.db('yogibo'); // .env에 지정된 데이터베이스 사용
    const entriesCollection = db.collection('entries');

    app.post('/api/entry', async (req, res) => {
      const { memberId } = req.body;
      if (!memberId) {
        return res.status(400).json({ error: 'memberId 값이 필요합니다.' });
      }
      try {
        const newEntry = {
          memberId: memberId,
          createdAt: new Date()
        };
        const result = await entriesCollection.insertOne(newEntry);
        res.json({
          message: '회원 아이디 저장 성공',
          entry: newEntry,
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error('회원 아이디 저장 오류:', error);
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