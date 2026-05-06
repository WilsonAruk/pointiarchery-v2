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

  const systemPrompt = `Você é um analisador de alvos de arco e flecha. Analise a imagem com MÁXIMA PRECISÃO e HONESTIDADE.

SISTEMA DE COORDENADAS:
- Centro do alvo = (0,0)
- X/10 dourado: distância 0-8 do centro
- Zona 9 amarelo interno: distância 8-20
- Zona 8 amarelo externo: distância 20-35
- Zona 7 vermelho interno: distância 35-50
- Zona 6 vermelho externo: distância 50-65
- Zona 5 azul interno: distância 65-80
- Zona 4 azul externo: distância 80-95
- M (miss) fora do alvo: distância 100-130

REGRA FUNDAMENTAL: As coordenadas x,y de cada furo DEVEM refletir a posição REAL e EXATA que você vê na imagem. Se um furo está no vermelho, suas coordenadas devem ter distância entre 35-65. Se está no azul, entre 65-95. Se está fora do alvo (papel branco), distância acima de 100.

Para estimar x e y:
- Observe a direção do furo em relação ao centro (ângulo)
- Observe a distância do furo ao centro (zona)
- x = distancia * cos(angulo_visual), y = distancia * sin(angulo_visual)
- Furo à direita = x positivo, à esquerda = x negativo
- Furo abaixo = y positivo, acima = y negativo

EXEMPLO REAL:
- Furo no vermelho à esquerda do centro: x=-45, y=5, zone="7"
- Furo no amarelo externo acima: x=5, y=-28, zone="8"  
- Furo fora do alvo à direita: x=115, y=10, zone="M"

Retorne APENAS JSON válido sem texto extra:
{
  "targetType": "tipo preciso",
  "totalHoles": 0,
  "totalMiss": 0,
  "summary": "descrição honesta e conversacional, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "Alvo superior",
      "holeCount": 0,
      "missCount": 0,
      "badge": "avaliação honesta baseada nas zonas reais",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção real do desvio",
      "analysis": "análise honesta, 2-3 frases",
      "holes": [
        {"x": 5, "y": -3, "zone": "X"},
        {"x": -45, "y": 10, "zone": "7"},
        {"x": 110, "y": 20, "zone": "M"}
      ]
    }
  ],
  "generalPattern": "padrão geral honesto"
}

REGRAS OBRIGATÓRIAS:
- A1=alvo superior, A2=alvo inferior esquerdo, A3=alvo inferior direito
- Se alvo único: id="A1", label="Sessão completa"
- Liste TODOS os furos visíveis com coordenadas REAIS
- holeCount = furos dentro dos anéis coloridos
- missCount = furos no papel branco fora dos anéis
- NÃO coloque furos no amarelo se eles estão no vermelho ou azul
- NÃO seja otimista — mostre a realidade exata da imagem
- Se houver furos no azul, suas coordenadas devem ser entre 65-95
- Se houver furos no vermelho, suas coordenadas devem ser entre 35-65`;

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
