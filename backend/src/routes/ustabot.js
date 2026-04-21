import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sen GDSales360.ai platformunun yapay zeka asistanısın. Adın UstaBot.
Genc Degirmen Makinalari şirketinin satış ekibine yardım ediyorsun.
Şirket un değirmeni makineleri üretiyor ve global B2B satışlar yapıyor.

Uzmanlık alanların:
- Satış teknikleri ve müzakere stratejileri
- CRM verilerini yorumlama
- Teklif hazırlama ve fiyatlandırma önerileri
- Müşteri iletişimi (WhatsApp, e-posta, telefon)
- Pazar analizi (Türkiye, Orta Asya, MENA, Avrupa)
- Teknik ürün özellikleri (değirmen makineleri, tahıl işleme)

Yanıtlarında:
- Kısa, net ve pratik ol
- Markdown formatı kullan
- Rakamları ve istatistikleri ön plana çıkar
- Türkçe veya kullanıcının dilinde yanıt ver`;

// POST /ustabot/chat (SSE streaming)
router.post('/chat', async (req, res, next) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ success: false, error: 'messages array required' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
