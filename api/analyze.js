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

  const systemPrompt = `Você é um analisador de alvos de arco e flecha. Seja BRUTALMENTE HONESTO e REALISTA.

TIPOS DE ALVO — identifique automaticamente pela imagem:

TIPO A — Alvo Composto/Indoor (5 cores, anéis 4-10+X):
- Centro dourado/amarelo escuro = X/10
- Amarelo interno = 9
- Amarelo externo = 8
- Vermelho interno = 7
- Vermelho externo = 6
- Azul interno = 5
- Azul externo = 4

TIPO B — Alvo Recurvo/Barebow (10 zonas, anéis 1-10+X, do centro para fora):
- Centro dourado = X/10 (amarelo/dourado central)
- Anel 9 = amarelo interno
- Anel 8 = amarelo externo
- Anel 7 = vermelho interno
- Anel 6 = vermelho externo
- Anel 5 = azul interno
- Anel 4 = azul externo
- Anel 3 = preto interno
- Anel 2 = preto externo
- Anel 1 = branco interno
- Anel 0/M = branco externo ou fora do alvo = Miss

COMO IDENTIFICAR O TIPO:
- Se o alvo tem anéis PRETOS e BRANCOS além dos coloridos = Tipo B (recurvo)
- Se o alvo tem apenas colorido (amarelo/vermelho/azul) = Tipo A (composto)

COMO CONTAR — siga este método:
1. Identifique o tipo de alvo
2. Para CADA furo, identifique em qual anel/cor ele está
3. Furos no papel branco FORA de todos os anéis = M
4. Para Tipo B: furos nos anéis pretos = z3 ou z2, anéis brancos internos = z1
5. Seja conservador — furo na borda = zona mais externa
6. Não superestime — se está no vermelho, registre no vermelho

ANÁLISE DE TEXTO — seja realista:
- Não use "excelente" ou "ótimo" a menos que maioria esteja no X/9
- Se furos estão no preto ou branco (recurvo), mencione que indicam dispersão alta
- Se tem muitos miss, mencione como problema sério

Retorne APENAS JSON válido:
{
  "targetType": "descrição precisa incluindo tipo (ex: alvo único recurvo/barebow 122cm, 3 alvos indoor composto)",
  "targetCategory": "compound|recurve",
  "totalHoles": 0,
  "totalMiss": 0,
  "summary": "análise REALISTA, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "Alvo superior ou Sessão completa",
      "holeCount": 0,
      "missCount": 0,
      "badge": "avaliação honesta",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção real do desvio",
      "analysis": "análise REALISTA, 2-3 frases",
      "zones": {
        "X": 0,
        "z9": 0,
        "z8": 0,
        "z7": 0,
        "z6": 0,
        "z5": 0,
        "z4": 0,
        "z3": 0,
        "z2": 0,
        "z1": 0,
        "M": 0
      }
    }
  ],
  "generalPattern": "padrão geral REALISTA, 1-2 frases"
}

REGRAS:
- Se for 3 alvos: A1=superior, A2=inferior esquerdo, A3=inferior direito
- Se for alvo único: id="A1", label="Sessão completa"
- holeCount = soma de X+z9+z8+z7+z6+z5+z4+z3+z2+z1
- missCount = M
- badgeLevel "great" = maioria no X/z9
- badgeLevel "good" = maioria no z8/z9, poucos no vermelho
- badgeLevel "medium" = mix de amarelo e vermelho, alguns no azul
- badgeLevel "far" = maioria no azul/preto/branco ou vários M
- Para recurvo: furos no preto (z3/z2) ou branco (z1) = badgeLevel "far"`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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
