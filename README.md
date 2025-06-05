# FLUXODRIVER - Controle Financeiro para Motoristas

Sistema completo de controle financeiro e afiliados para motoristas profissionais no Brasil.

## Características

- **Trial gratuito**: 48 horas de uso completo
- **Assinatura**: R$ 29,90 por 90 dias via PIX
- **Sistema de afiliados**: 45% de comissão
- **Controle financeiro**: KM, horas, ganhos e gastos
- **Responsivo**: Interface otimizada para mobile

## Tecnologias

- Node.js + Express
- Supabase PostgreSQL
- JWT Authentication
- PushinPay (pagamentos PIX)
- Tailwind CSS
- PWA Ready

## Instalação

### 1. Clone o repositório
```bash
git clone <seu-repositorio>
cd fluxodriver
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
Crie um arquivo `.env`:
```env
DATABASE_URL=postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
JWT_SECRET=fluxodriver-jwt-secret-pokejr55-2024
PORT=5000
```

### 4. Execute o servidor
```bash
npm start
```

O sistema estará disponível em `http://localhost:5000`

## Deploy no Vercel

### 1. Conecte seu repositório ao Vercel

### 2. Configure as variáveis de ambiente:
```
DATABASE_URL=postgresql://postgres.ikcqwzwhekqqysvoihgc:pokejr55@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
JWT_SECRET=fluxodriver-jwt-secret-pokejr55-2024
```

### 3. Deploy automático
O Vercel fará o deploy automaticamente a cada push.

## Estrutura do Projeto

```
├── api/
│   ├── index.js          # Entry point para Vercel
│   └── package.json      # Dependências serverless
├── server.js             # Servidor principal
├── index.html            # Frontend PWA
├── package.json          # Dependências Node.js
├── vercel.json           # Configuração Vercel
├── manifest.json         # PWA manifest
└── sw.js                 # Service Worker
```

## API Endpoints

### Autenticação
- `POST /api/register` - Registrar usuário
- `POST /api/login` - Login

### Registros Financeiros
- `GET /api/records` - Listar registros
- `POST /api/records` - Criar registro
- `DELETE /api/records/:id` - Deletar registro

### Sistema de Afiliados
- `GET /api/affiliate/stats` - Estatísticas do afiliado
- `POST /api/affiliate/withdraw` - Solicitar saque

### Pagamentos
- `POST /api/create-pix-payment` - Criar pagamento PIX

## Funcionalidades

### Para Motoristas
- Controle de quilometragem e horas trabalhadas
- Registro de ganhos (Uber, corridas, gorjetas)
- Controle de gastos (combustível, alimentação, etc.)
- Relatórios automáticos
- Trial gratuito de 48 horas

### Sistema de Afiliados
- Códigos únicos de referência
- Comissão de 45% sobre vendas
- Saque mínimo de R$ 10,00
- Relatórios de performance

## Banco de Dados

O sistema utiliza Supabase PostgreSQL com as seguintes tabelas:
- `Users` - Usuários do sistema
- `Records` - Registros financeiros
- `Affiliates` - Sistema de afiliados
- `Commissions` - Comissões dos afiliados
- `Fines` - Registro de multas
- `Maintenances` - Registro de manutenções

## Licença

Projeto proprietário - Todos os direitos reservados.