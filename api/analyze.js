export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
 
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
 
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }
  if (!body) body = {};
 
  const { imageBase64, imageMime } = body;
 
  if (!imageBase64 || !imageMime) {
    return res.status(400).json({ error: 'Imagem não enviada' });
  }
 
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key não configurada no servidor' });
  }
 
  const systemPrompt = `Você é um analisador especializado de alvos de arco e flecha para o app PointIArchery. Analise a imagem e retorne APENAS um JSON válido, sem texto adicional, markdown ou backticks.
 
Estrutura obrigatória:
{
  "targetType": "descrição do tipo (ex: 3 alvos indoor, Las Vegas, alvo único outdoor)",
  "summary": "resumo geral em linguagem conversacional e humana, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "nome do alvo (ex: Alvo superior, Sessão completa)",
      "badge": "avaliação curta (ex: muito próximo do X, longe do X)",
      "badgeLevel": "great|good|medium|far",
      "desvio": "descrição do desvio (ex: leve desvio à esquerda, sem eixo claro)",
      "analysis": "análise conversacional e humana, 2-3 frases"
    }
  ],
  "generalPattern": "padrão geral identificado, 1-2 frases conversacionais"
}
 
Regras:
- badgeLevel: great=furos no X ou muito próximos, good=amarelo interno, medium=amarelo externo ou vermelho, far=vermelho ou azul
- Referência sempre é a PROXIMIDADE DO X, não a zona colorida
- Linguagem humana, direta, sem jargão técnico excessivo
- Se for alvo único: 1 item no array com id "A1" e label "Sessão completa"
- Se for 3 alvos: 3 itens A1, A2, A3 com labels descritivos de posição
- Identifique o tipo de alvo automaticamente pela imagem`;
 
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: imageMime, data: imageBase64 }
            },
            {
              type: 'text',
              text: 'Analise este alvo de arco e flecha e retorne o JSON de dispersão.'
            }
          ]
        }]
      })
    });
 
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Erro na API Anthropic' });
    }
 
    const data = await response.json();
    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(raw);
 
    return res.status(200).json({ analysis });
 
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro ao processar a imagem.' });
  }
}
