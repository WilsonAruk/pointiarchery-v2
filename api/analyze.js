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

  const systemPrompt = `Você é um analisador PRECISO e REALISTA de alvos de arco e flecha. Analise a imagem com máxima atenção aos detalhes visuais reais.

IDENTIFICAÇÃO DAS ZONAS (do centro para fora):
- X / 10: círculo dourado central pequeno (pontuação máxima)
- 9: anel amarelo interno
- 8: anel amarelo externo
- 7: anel vermelho interno
- 6: anel vermelho externo
- 5: anel azul interno
- 4: anel azul externo
- M (Miss): furo FORA do alvo, no papel branco ao redor — conta como erro grave

COMO ANALISAR CADA FURO:
1. Localize o centro exato do alvo (cruz/X)
2. Para cada furo, identifique a zona exata onde está
3. Furos no papel BRANCO fora dos anéis coloridos = M (Miss)
4. Seja CONSERVADOR: furo na borda = zona mais externa
5. "great" APENAS se o furo tocar ou estiver dentro do círculo X dourado

REGRAS DE CLASSIFICAÇÃO:
- badgeLevel "great" = todos ou maioria dos furos no X/10
- badgeLevel "good" = maioria no amarelo (8-9), sem M
- badgeLevel "medium" = furos no vermelho (6-7) ou amarelo externo com dispersão
- badgeLevel "far" = furos no azul (4-5) ou com M (Miss)

Retorne APENAS um JSON válido, sem texto adicional, markdown ou backticks:
{
  "targetType": "descrição precisa (ex: 3 alvos indoor triangular, alvo único Las Vegas)",
  "totalHoles": 0,
  "totalMiss": 0,
  "summary": "descrição HONESTA e conversacional, mencione M se houver, 2-3 frases",
  "targets": [
    {
      "id": "A1",
      "label": "posição do alvo (Alvo superior / Alvo inferior esquerdo / Alvo inferior direito / Sessão completa)",
      "holeCount": 0,
      "missCount": 0,
      "badge": "avaliação HONESTA baseada nas zonas reais",
      "badgeLevel": "great|good|medium|far",
      "desvio": "direção real e honesta do desvio em relação ao centro",
      "analysis": "análise HONESTA, 2-3 frases — mencione furos fora do alvo (M) se houver"
    }
  ],
  "generalPattern": "padrão real e honesto, mencione M se relevante, 1-2 frases"
}

REGRAS FINAIS:
- Se for 3 alvos: A1=superior, A2=inferior esquerdo, A3=inferior direito
- Se for alvo único: 1 item com id "A1" e label "Sessão completa"
- holeCount: furos DENTRO do alvo (nos anéis coloridos)
- missCount: furos FORA do alvo (no papel branco) — M
- totalHoles: soma de todos holeCount
- totalMiss: soma de todos missCount
- NUNCA elogie demais — seja sempre realista
- Se não conseguir ver claramente, informe isso no summary`;

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
