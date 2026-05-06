export default async function handler(req, res) {
if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key não configurada no servidor' });
  }

  const systemPrompt = `Você é um analisador especializado de alvos de arco e flecha para o app PointIArchery. Analise a imagem e retorne APENAS um JSON válido, sem texto adicional, markdown ou backticks.

Estrutura obrigatória:
{
  "targetType": "descrição do tipo (ex: 3 alvos indoor, Las Vegas, alvo único outdoor)
