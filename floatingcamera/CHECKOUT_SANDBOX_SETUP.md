# Floating Camera — Checkout Sandbox

Esta página é uma ferramenta de homologação, não deve ser divulgada como checkout de produção.

## Arquivo
- `conta-sandbox.html`: cria/usa uma conta Supabase Auth, autentica e chama a Edge Function `create-checkout`.
- A página contém somente a URL e a publishable key do projeto Supabase de staging. Não incluir service-role/secret key, Paddle API key, webhook secret ou a chave privada Ed25519.

## Configuração obrigatória no Supabase Auth
No projeto `floating-camera-licensing-staging`:
1. Authentication → URL Configuration.
2. Adicionar à lista de Redirect URLs o endereço final que hospedará `conta-sandbox.html`, por exemplo:
   `https://www.l30.tec.br/floatingcamera/conta-sandbox.html`
3. Confirmar o Site URL do ambiente de staging e o SMTP de confirmação de e-mail.
4. Não desativar a confirmação de e-mail em produção somente para facilitar testes.

## Segredos do Edge Function
No projeto Supabase de staging, conferir em Edge Functions → Secrets:
- `PADDLE_API_KEY` (Sandbox)
- `PADDLE_API_BASE_URL=https://sandbox-api.paddle.com`
- `PADDLE_PRICE_MONTHLY_SUBSCRIPTION` (Price ID mensal do Sandbox)
- `PADDLE_PRICE_ANNUAL_SUBSCRIPTION` (Price ID anual do Sandbox)
- `PADDLE_WEBHOOK_SECRET` (segredo do destino de notificações Sandbox)
- `LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64` (chave privada Ed25519 mantida somente no servidor)
- `L30_SITE_URL` com a origem exata permitida para CORS, sem o caminho da página.

As chaves secret/service-role do Supabase e os segredos da Paddle não devem ser colocados em HTML, JavaScript público ou no repositório.

## Teste ponta a ponta
1. Hospedar esta página em um ambiente de teste com HTTPS e adicionar sua URL à lista de Redirect URLs.
2. Criar uma conta de homologação e confirmar o e-mail.
3. Entrar e iniciar o plano mensal no Sandbox; conferir o preço, período de teste, moeda, impostos e dados na tela Paddle.
4. Repetir para o plano anual.
5. Confirmar os eventos Paddle no webhook e verificar pedido/entitlement no Supabase.
6. Entrar no Floating Camera Preview.3 com a mesma conta e validar a ativação Pro.
7. Repetir em modo empresa com mais de um assento e testar o limite.

## Limitações desta entrega
- A página ainda não está conectada ao site público. O branch deve ser revisado e hospedado em ambiente de homologação antes de uso.
- A URL de confirmação precisa ser autorizada no Supabase Auth.
- A existência dos segredos e dos Price IDs precisa ser confirmada no painel Supabase/Paddle; não é possível ler seus valores através do repositório.
- Não realizar pagamentos reais por esta página.
