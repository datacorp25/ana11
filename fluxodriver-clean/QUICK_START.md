# FLUXODRIVER - Início Rápido

## Para Git/GitHub

### 1. Subir para GitHub
```bash
git init
git add .
git commit -m "FLUXODRIVER - Sistema completo"
git branch -M main
git remote add origin https://github.com/seu-usuario/fluxodriver.git
git push -u origin main
```

### 2. Deploy Vercel (1 clique)
- Acesse vercel.com
- Conecte GitHub → Importe repositório
- Configure variáveis:
  ```
  DATABASE_URL=postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
  JWT_SECRET=fluxodriver-jwt-secret-pokejr55-2024
  ```
- Deploy automático

### 3. Desenvolvimento Local
```bash
npm install
npm start
# Acesse: http://localhost:5000
```

## Sistema Funcionando

O sistema já foi testado e está 100% operacional:
- Registro/Login de usuários
- Trial gratuito 48h
- Controle financeiro completo
- Sistema de afiliados 45%
- Pagamentos PIX
- Interface responsiva

## Arquivos Principais

- `server.js` - Backend completo
- `index.html` - Frontend PWA
- `api/index.js` - Vercel entry point
- `vercel.json` - Configuração deploy
- `.env.example` - Template configuração

## Pronto para Produção

Sistema testado com:
- Banco Supabase conectado
- APIs funcionais
- Autenticação JWT
- Pagamentos configurados
- Interface otimizada