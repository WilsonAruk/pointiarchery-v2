const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, imageMime = 'image/jpeg', distance = '' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'Imagem não fornecida' });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const distanceNote = distance ? `Distância de tiro informada: ${distance}.` : '';

    const prompt = `Você é um analisador especializado em alvos de arco e flecha. Analise esta imagem de alvo(s) com rigor e precisão.

${distanceNote}

IDENTIFICAÇÃO DO TIPO DE ALVO:
- Tipo A (Composto/Indoor): Alvo pequeno 5 cores, apenas zonas amarelas (X e 9), vermelhas (8 e 7), azuis (6 e 5) e eventualmente pretas (4)
- Tipo B (Recurvo/Barebow/Outdoor): Alvo grande 122cm com anéis brancos/pretos externos (zonas 1-4), azuis (5-6), vermelhos (7-8) e amarelos (9-10+X)

IDENTIFICAÇÃO DOS ALVOS NA IMAGEM:
- Se houver múltiplos alvos, identifique cada um: A1 = superior ou único, A2 = inferior esquerdo, A3 = inferior direito
- Se houver apenas 1 alvo, identifique como A1

CONTAGEM OBRIGATÓRIA DE FUROS POR ZONA (seja conservador — na dúvida, não conte):
Para cada alvo, conte separadamente os furos em cada zona:
- X: furo no centro exato (anel X)
- z9: zona 9 (amarelo externo ou anel 9)
- z8: zona 8 (vermelho interno)
- z7: zona 7 (vermelho externo)
- z6: zona 6 (azul interno)
- z5: zona 5 (azul externo)
- z4: zona 4 (preto interno — se houver)
- z3: zona 3 (preto externo — apenas recurvo)
- z2: zona 2 (branco interno — apenas recurvo)
- z1: zona 1 (branco externo — apenas recurvo)
- M: furos FORA do alvo completamente (no papel branco ao redor)

ATENÇÃO:
- Só conte furos que você consegue ver claramente
- Furos no papel branco ao redor = M (miss)
- Furos rasgados grandes = múltiplos furos naquele ponto (mas seja conservador)

AVALIE para cada alvo:
- Agrupamento: onde está o centro de massa dos furos
- Desvio: direção predominante (esquerda/direita/acima/abaixo/centralizado)
- Qualidade: great (maioria X/9), good (maioria 8/9), medium (maioria 6/7/8), far (maioria 4/5 ou menos)

Responda APENAS com JSON válido, sem texto antes ou depois:

{
  "targetType": "Tipo A - Composto Indoor" ou "Tipo B - Recurvo/Barebow",
  "summary": "Texto conversacional de 2-3 frases descrevendo a sessão como um todo, incluindo distância se fornecida",
  "totalHoles": número_total_furos_no_alvo,
  "totalMiss": número_total_de_M,
  "generalPattern": "Padrão geral observado entre os alvos (1-2 frases)",
  "targets": [
    {
      "id": "A1",
      "label": "Alvo superior",
      "holeCount": número,
      "missCount": número,
      "badge": "Excelente agrupamento no centro",
      "badgeLevel": "great",
      "desvio": "centralizado com leve tendência para baixo",
      "zones": {
        "X": 0, "z9": 0, "z8": 0, "z7": 0, "z6": 0, "z5": 0, "z4": 0, "z3": 0, "z2": 0, "z1": 0, "M": 0
      },
      "analysis": "Texto de 2-3 frases analisando este alvo específico de forma realista"
    }
  ]
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: imageMime, data: imageBase64 }
        }, {
          type: 'text',
          text: prompt
        }]
      }]
    });

    let responseText = message.content[0].text.trim();

    // Clean up markdown code blocks if present
    responseText = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (e) {
      // Try to extract JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          return res.status(500).json({ error: 'Resposta da IA inválida. Tente novamente.' });
        }
      } else {
        return res.status(500).json({ error: 'Não foi possível analisar a resposta. Tente novamente.' });
      }
    }

    // Ensure required fields
    if (!analysis.targets) analysis.targets = [];
    if (!analysis.totalHoles) analysis.totalHoles = analysis.targets.reduce((s, t) => s + (t.holeCount || 0), 0);
    if (!analysis.totalMiss) analysis.totalMiss = analysis.targets.reduce((s, t) => s + (t.missCount || 0), 0);

    return res.status(200).json({ analysis });

  } catch (error) {
    console.error('Error:', error);
    const msg = error.message || 'Erro interno';
    return res.status(500).json({ error: msg });
  }
};
