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
    const db = client.db(); // .env에 지정된 데이터베이스 사용
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
        
        // 참여 기록 삽입
        const newEntry = {
          memberId: memberId,
          createdAt: new Date()
        };
        const result = await entriesCollection.insertOne(newEntry);

        // 전체 참여자 수를 계산
        const count = await entriesCollection.countDocuments();
        
        res.json({
          message: '이벤트 응모 완료 되었습니다.',
          entry: newEntry,
          insertedId: result.insertedId,
          count: count  // 총 참여자 수 반환
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


