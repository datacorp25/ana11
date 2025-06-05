# FLUXODRIVER - Deploy via Git/GitHub

## 1. Preparar Repositório Local

```bash
# Inicializar repositório Git
git init

# Adicionar arquivos
git add .

# Primeiro commit
git commit -m "Initial commit - FLUXODRIVER v1.0"
```

## 2. Conectar ao GitHub

```bash
# Adicionar origem remota (substitua pela sua URL)
git remote add origin https://github.com/seu-usuario/fluxodriver.git

# Push inicial
git push -u origin main
```

## 3. Deploy Automático via GitHub

### Opção A: Vercel (Recomendado)

1. Acesse [vercel.com](https://vercel.com)
2. Conecte sua conta GitHub
3. Importe o repositório `fluxodriver`
4. Configure as variáveis de ambiente:
   ```
   DATABASE_URL=postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   JWT_SECRET=fluxodriver-jwt-secret-pokejr55-2024
   ```
5. Deploy automático a cada push

### Opção B: Heroku

```bash
# Instalar Heroku CLI
# Criar app Heroku
heroku create fluxodriver-app

# Configurar variáveis
heroku config:set DATABASE_URL="postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
heroku config:set JWT_SECRET="fluxodriver-jwt-secret-pokejr55-2024"

# Deploy
git push heroku main
```

### Opção C: Railway

1. Acesse [railway.app](https://railway.app)
2. Conecte repositório GitHub
3. Configure variáveis de ambiente
4. Deploy automático

## 4. Estrutura para Git

```
fluxodriver/
├── api/                 # Vercel serverless
├── server.js           # Servidor principal
├── index.html          # Frontend
├── package.json        # Dependências
├── vercel.json         # Config Vercel
├── .env.example        # Exemplo env
├── .gitignore          # Arquivos ignorados
├── README.md           # Documentação
└── DEPLOY_GIT.md       # Este guia
```

## 5. Comandos Git Úteis

```bash
# Atualizar projeto
git add .
git commit -m "Update: nova funcionalidade"
git push origin main

# Ver status
git status

# Ver histórico
git log --oneline

# Criar branch para desenvolvimento
git checkout -b feature/nova-funcionalidade
git push -u origin feature/nova-funcionalidade
```

## 6. CI/CD Automático

O arquivo `vercel.json` já está configurado para:
- Deploy automático a cada push
- Configuração de rotas
- Variáveis de ambiente
- Build commands

## 7. Monitoramento

Após deploy, monitore:
- Logs de aplicação
- Conexão com banco Supabase
- Performance das APIs
- Status dos pagamentos PIX

## URLs de Exemplo

- **Desenvolvimento**: `http://localhost:5000`
- **Vercel**: `https://fluxodriver.vercel.app`
- **Heroku**: `https://fluxodriver-app.herokuapp.com`

## Troubleshooting

**Erro de conexão banco:**
- Verificar DATABASE_URL nas variáveis de ambiente
- Confirmar conectividade Supabase

**Erro de autenticação:**
- Verificar JWT_SECRET configurado
- Confirmar token válido

**Erro 404 em produção:**
- Verificar vercel.json configurado
- Confirmar rotas da API