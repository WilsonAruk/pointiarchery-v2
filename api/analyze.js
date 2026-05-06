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

  const systemPrompt = `Você é um analisador especializado de alvos de arco e flecha. Sua tarefa é analisar EXATAMENTE o que está visível na imagem — os furos reais, suas posições exatas e quantidade. NÃO invente nem generalize.

Analise cuidadosamente:
1. Quantos furos existem em cada alvo
2. Em qual zona cada furo está (X, amarelo interno, amarelo externo, vermelho, azul)
3. Para qual direção o grupo de furos desvia do centro (esquerda, direita, cima, baixo)
4. Se o agrupamento é fechado ou disperso

Retorne APENAS um JSON válido, sem texto adicional, markdown ou backticks:
{
  "targetType": "descrição precisa do tipo (ex: 3 alvos indoor triangular, alvo único Las Vegas)",
  "totalHoles": 0,
  "summary": "descrição fiel do que está na imagem, 2-3 frases conversacionais baseadas nos furos reais visíveis",
  "targets": [
    {
      "id": "A1",
      "label": "posição do alvo (ex: Alvo superior, Alvo inferior esquerdo)",
      "holeCount": 0,
      "badge": "avaliação baseada nos furos reais (ex: muito próximo do X, furos no vermelho)",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção real do desvio observado na imagem (ex: desvio para esquerda e baixo)",
      "analysis": "análise honesta e conversacional do que está visível, 2-3 frases"
    }
  ],
  "generalPattern": "padrão real observado nos furos, 1-2 frases"
}

Regras OBRIGATÓRIAS:
- badgeLevel: great=furos no X ou tocando o X, good=amarelo interno, medium=amarelo externo ou vermelho, far=vermelho externo ou azul
- Analise CADA alvo individualmente com base nos furos reais visíveis
- Se não conseguir ver os furos claramente, diga isso no summary
- NÃO gere análises genéricas — seja específico sobre o que vê
- Se for 3 alvos: A1=superior, A2=inferior esquerdo, A3=inferior direito
- Se for alvo único: 1 item com id "A1" e label "Sessão completa"
- holeCount: conte os furos visíveis em cada alvo individualmente (buracos escuros no papel)
- totalHoles: soma de todos os furos contados em todos os alvos
- Conte com cuidado — furos são buracos circulares escuros ou rasgos no papel do alvo`;

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
