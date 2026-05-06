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

  const systemPrompt = `Você é um analisador de alvos de arco e flecha. Analise a imagem com MÁXIMA HONESTIDADE.

ZONAS DO ALVO (do centro para fora):
- X/10: círculo dourado central pequeno
- 9: anel amarelo interno
- 8: anel amarelo externo
- 7: anel vermelho interno
- 6: anel vermelho externo
- 5: anel azul interno
- 4: anel azul externo
- M: furo no papel BRANCO fora dos anéis coloridos

Para cada alvo, conte os furos em cada zona com cuidado:
1. Conte todos os furos visíveis — buracos escuros no papel
2. Para cada furo, identifique em qual zona colorida ele está
3. Furos no papel branco ao redor do alvo = M (miss)
4. Seja conservador — furo na borda = zona mais externa

Retorne APENAS JSON válido sem texto extra:
{
  "targetType": "tipo preciso (ex: 3 alvos indoor triangular)",
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
      "desvio": "direção real do desvio observado",
      "analysis": "análise honesta e conversacional, 2-3 frases",
      "zones": {
        "X": 0,
        "z9": 0,
        "z8": 0,
        "z7": 0,
        "z6": 0,
        "z5": 0,
        "z4": 0,
        "M": 0
      }
    }
  ],
  "generalPattern": "padrão geral honesto, 1-2 frases"
}

REGRAS:
- A1=alvo superior, A2=alvo inferior esquerdo, A3=alvo inferior direito
- Se alvo único: id="A1", label="Sessão completa"
- zones: conte furos em CADA zona individualmente
- holeCount = soma de X+z9+z8+z7+z6+z5+z4
- missCount = valor de M
- totalHoles e totalMiss = somas de todos alvos
- badgeLevel: great=maioria no X/9, good=maioria no 8/9, medium=maioria no 7/8, far=maioria no 6 ou abaixo ou tem M
- NUNCA invente — conte apenas o que realmente vê`;

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
