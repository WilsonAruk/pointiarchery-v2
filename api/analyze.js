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

  const systemPrompt = `Você é um analisador PRECISO e REALISTA de alvos de arco e flecha.

ZONAS DO ALVO (do centro para fora):
- X/10: círculo dourado central
- 9: anel amarelo interno
- 8: anel amarelo externo  
- 7: anel vermelho interno
- 6: anel vermelho externo
- 5: anel azul interno
- 4: anel azul externo
- M: furo fora do alvo, no papel branco

Para cada furo, estime a posição em coordenadas (x,y) usando este sistema:
- Centro do alvo = (0, 0)
- Escala: raio do alvo completo = 100 unidades
- X positivo = direita, X negativo = esquerda
- Y positivo = baixo, Y negativo = cima
- Furo no X: distância ~0-5 do centro
- Furo no 9: distância ~5-20
- Furo no 8: distância ~20-35
- Furo no 7: distância ~35-50
- Furo no 6: distância ~50-65
- Furo no 5: distância ~65-80
- Furo no 4: distância ~80-100
- Furo M (miss): distância >100

Retorne APENAS JSON válido sem texto extra:
{
  "targetType": "tipo preciso do alvo",
  "totalHoles": 0,
  "totalMiss": 0,
  "summary": "análise honesta e conversacional, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "Alvo superior",
      "holeCount": 0,
      "missCount": 0,
      "badge": "avaliação honesta",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção real do desvio",
      "analysis": "análise honesta, 2-3 frases",
      "holes": [
        {"x": 0, "y": 0, "zone": "X|9|8|7|6|5|4|M"}
      ]
    }
  ],
  "generalPattern": "padrão geral honesto, 1-2 frases"
}

REGRAS:
- Se for 3 alvos: A1=superior, A2=inferior esquerdo, A3=inferior direito
- Se for alvo único: 1 item com id "A1" e label "Sessão completa"
- holes: liste TODOS os furos visíveis com posição estimada real
- holeCount: furos dentro do alvo, missCount: furos no papel branco
- totalHoles e totalMiss: somas de todos os alvos
- Seja REALISTA e CONSERVADOR — não superestime a precisão
- Furos no papel branco = M, coordenadas com distância > 100
- NUNCA elogie demais, descreva o que realmente está visível`;

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
        max_tokens: 4000,
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
    let raw = data.content[0].text.trim();
    
    // Remove markdown fences
    raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Find first { and last } to extract JSON
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      raw = raw.substring(firstBrace, lastBrace + 1);
    }

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch(parseErr) {
      // If JSON is broken, try to fix common issues and retry
      // Remove any trailing commas before } or ]
      raw = raw.replace(/,(\s*[}\]])/g, '$1');
      // Fix unescaped quotes in strings (basic attempt)
      try {
        analysis = JSON.parse(raw);
      } catch(e2) {
        // Return a safe fallback analysis
        console.error('JSON parse error:', parseErr.message);
        console.error('Raw:', raw.substring(0, 500));
        analysis = {
          targetType: "Não foi possível identificar",
          totalHoles: 0,
          totalMiss: 0,
          summary: "Não foi possível analisar esta imagem. Tente novamente com melhor iluminação e o alvo centralizado.",
          targets: [{
            id: "A1",
            label: "Sessão completa",
            holeCount: 0,
            missCount: 0,
            badge: "análise indisponível",
            badgeLevel: "medium",
            desvio: "não identificado",
            analysis: "Erro ao processar a imagem. Por favor, tente novamente.",
            holes: []
          }],
          generalPattern: "Não foi possível processar."
        };
      }
    }

    return res.status(200).json({ analysis });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro ao processar a imagem.' });
  }
}
