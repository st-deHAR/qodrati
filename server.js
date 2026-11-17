import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// تهيئة عميل جوجل بالمتغير البيئي الجديد
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Qodrati AI Backend is running smoothly' });
});

// نقطة نهاية استخراج الأسئلة من الـ PDF
app.post('/api/questions/extract', async (req, res) => {
  try {
    const { text, pageNumbers, sourceFileName } = req.body;

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'No text provided for extraction' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    console.log(`Processing extraction for file: ${sourceFileName}, pages: ${pageNumbers || 'all'}`);

    const prompt = `
أنت خبير تعليمي ذكي لمنصة "قدرات". قم بتحليل النص المرفق من ملف PDF واستخراج الأسئلة التعليمية والتدريبية منه بدقة.
يجب أن يكون الناتج بصيغة JSON صالح فقط (Array of Objects) بدون أي نصوص إضافية أو علامات markdown خارجية إن أمكن، بحيث يحتوي كل سؤال على الحقول التالية:
- questionText (نص السؤال)
- options (مصفوفة من الخيارات، 4 خيارات)
- correctAnswer (الإجابة الصحيحة بالضبط كما هي في الخيارات)
- explanation (شرح تفصيلي ومبسط للإجابة)
- questionType (نوع السؤال: "quantitative" كمي أو "verbal" لفظي)

النص المراد تحليله:
${text}
    `;

    // استخدام النموذج الأحدث المطلوب من المكتبة
    const response = await ai.models.generateContent({
      model: 'models/gemini-3.8-flash',
      contents: prompt,
    });

    const rawResponseText = response.text || '';
    console.log("Gemini raw response received.");

    // تنظيف النص لضمان استخراج الـ JSON بشكل سليم
    let cleanJsonText = rawResponseText.trim();
    if (cleanJsonText.startsWith('```json')) {
      cleanJsonText = cleanJsonText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanJsonText.startsWith('```')) {
      cleanJsonText = cleanJsonText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    let parsedQuestions;
    try {
      parsedQuestions = JSON.parse(cleanJsonText);
    } catch (parseError) {
      console.error("JSON Parse Error, raw text was:", rawResponseText);
      return res.status(500).json({ 
        error: 'Failed to parse AI response into JSON', 
        raw: rawResponseText 
      });
    }

    res.json({ success: true, questions: parsedQuestions });

  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error during extraction', 
      details: error.message || error 
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
