const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const ai = new GoogleGenAI();

app.get('/', (req, res) => {
    res.send('Qodrati Backend API is running successfully!');
});

app.post('/api/questions/extract', async (req, res) => {
    try {
        const { text, pageNumbers, sourceFileName } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'No text provided for extraction.' });
        }

        const prompt = `أنت مساعد ذكاء اصطناعي خبير في اختبارات القدرات السعودية (الكمي واللفظي). 
أمامك نص مستخرج من صفحات ملف PDF (${sourceFileName || 'ملف PDF'}):
${text}

مهمتك: استخرج أسئلة "الاختيار من متعدد" (Multiple Choice Questions) من هذا النص بدقة، واضبط كل سؤال بحيث يكون له:
1. نص السؤال بوضوح.
2. القسم (quant للكمي أو verbal لللفظي).
3. أربعة خيارات (أ، ب، ج، د).
4. رقم الإجابة الصحيحة (0 للخيار الأول، 1 للثاني، 2 للثالث، 3 للرابع).
5. شرح مبسط لطريقة الحل.

أرجع النتيجة بصيغة JSON صالح فقط (Valid JSON format) ودون أي نصوص إضافية خارجه، بالشكل التالي:
{
  "questions": [
    {
      "text": "نص السؤال هنا",
      "category": "quant",
      "options": ["خيار أ", "خيار ب", "خيار ج", "خيار د"],
      "correctIndex": 0,
      "explanation": "شرح الحل هنا",
      "pageNumber": 1,
      "needsReview": false
    }
  ],
  "warnings": []
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json'
            }
        });

        const resultText = response.text();
        const parsedData = JSON.parse(resultText);
        
        res.json(parsedData);

    } catch (error) {
        console.error('Extraction error:', error);
        res.status(500).json({ 
            error: 'حدث خطأ أثناء معالجة الطلب عبر الذكاء الاصطناعي.',
            details: error.message 
        });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
