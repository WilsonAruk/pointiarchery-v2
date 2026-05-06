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

  const systemPrompt = `Você é um analisador de alvos de arco e flecha. Seja BRUTALMENTE HONESTO e REALISTA. Não elogie — descreva exatamente o que vê.

ZONAS DO ALVO (do centro para fora, identifique pela COR):
- X: pontinho dourado central — raramente acertado
- z9: anel AMARELO INTERNO (mais próximo do centro)
- z8: anel AMARELO EXTERNO (amarelo mais afastado do centro)
- z7: anel VERMELHO INTERNO
- z6: anel VERMELHO EXTERNO
- z5: anel AZUL INTERNO
- z4: anel AZUL EXTERNO
- M: furo no papel BRANCO fora de todos os anéis

COMO CONTAR — siga este método:
1. Olhe CADA alvo separadamente
2. Para CADA furo visível, olhe a COR do anel onde está
3. Furo no amarelo = z8 ou z9. Furo no vermelho = z7 ou z6. Furo no azul = z5 ou z4.
4. Papel branco fora dos anéis = M
5. Não assuma — olhe a cor real

ATENÇÃO: Na maioria dos alvos amadores, a maioria dos furos fica no VERMELHO (z6-z7) e AMARELO EXTERNO (z8). Poucos ficam no X ou z9. Seja honesto sobre isso.

ANÁLISE DE TEXTO — seja realista:
- Não use palavras como "excelente", "ótimo", "muito bom" a menos que os furos estejam realmente no X/z9
- Se furos estão no vermelho, diga "tiros no vermelho indicam dispersão"
- Se tem miss, mencione como problema a corrigir
- Linguagem direta e honesta

Retorne APENAS JSON válido:
{
  "targetType": "tipo preciso",
  "totalHoles": 0,
  "totalMiss": 0,
  "summary": "análise REALISTA — mencione dispersão se existir, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "Alvo superior",
      "holeCount": 0,
      "missCount": 0,
      "badge": "avaliação honesta (ex: dispersão alta, bom centro, muitos no vermelho)",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção predominante dos furos em relação ao centro",
      "analysis": "análise REALISTA, 2-3 frases, sem elogios excessivos",
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
  "generalPattern": "padrão geral REALISTA, 1-2 frases"
}

REGRAS FINAIS:
- A1=alvo superior, A2=alvo inferior esquerdo, A3=alvo inferior direito
- holeCount = X+z9+z8+z7+z6+z5+z4 (furos DENTRO dos anéis coloridos)
- missCount = M (furos no papel branco)
- badgeLevel "great" APENAS se maioria no X ou z9
- badgeLevel "good" se maioria no z8-z9
- badgeLevel "medium" se maioria no z7-z8 ou mix com vermelho
- badgeLevel "far" se maioria no z6 ou abaixo, ou vários M
- Se vir furos espalhados pelo vermelho E azul, o badgeLevel é "far"`;

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
