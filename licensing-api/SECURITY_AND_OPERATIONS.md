# Floating Camera — produção, custódia de chaves e operação

Este documento descreve o procedimento de produção. O Worker e as alterações estão em uma branch de desenvolvimento; nada aqui significa que o serviço esteja implantado ou pronto para receber pagamentos.

## Componentes e responsabilidades

- Aplicativo Windows: contém somente chaves públicas. Nunca assina licenças.
- Cloudflare Worker: emite v2 após pagamento validado e registra emissões manuais autenticadas.
- Cloudflare Worker Secret: custodia a chave privada de assinatura em runtime.
- Cloudflare D1: mantém clientes, pedidos, trials, licenças, eventos processados e trilha de auditoria.
- Paddle: processa pagamento. O redirecionamento do checkout não é confirmação de pagamento; a emissão depende do webhook autenticado.

## Procedimento de criação da chave

1. Faça checkout da branch de desenvolvimento do aplicativo e do site/API.
2. Execute tools/generate_signing_key.py em uma estação Windows controlada, com disco protegido por BitLocker.
3. O script cria:
   - private_key_pkcs8.b64: cópia temporária local para cadastro do Worker Secret;
   - public_key.b64: chave pública para o keyring do aplicativo;
   - private_key_backup.enc: backup AES-256-GCM, protegido por senha derivada com PBKDF2-HMAC-SHA256 (600.000 iterações);
   - key_metadata.json: metadados não secretos.
4. Não sincronize o arquivo private_key_pkcs8.b64 com Google Drive, Dropbox, GitHub ou qualquer pasta compartilhada.
5. Mantenha duas cópias do backup .enc em locais independentes. A senha do backup deve ficar em um gerenciador de senhas, separada dos arquivos.
6. Cadastre a chave privada como Worker Secret com o nome LICENSE_SIGNING_KEY_PKCS8_B64.
7. Cadastre um token administrativo longo e aleatório como LICENSE_ADMIN_TOKEN.
8. Depois de validar a emissão, remova a cópia temporária private_key_pkcs8.b64. Preserve os backups criptografados e os metadados.
9. Faça um teste de restauração do backup em ambiente isolado antes do lançamento e documente o resultado sem registrar a chave.

Comando de cadastro (execute somente quando o Worker estiver provisionado e o ambiente correto estiver selecionado):

\`\`\`powershell
Get-Content -Raw "$env:LOCALAPPDATA\L30Technology\FloatingCamera\keys\private_key_pkcs8.b64" | npx wrangler secret put LICENSE_SIGNING_KEY_PKCS8_B64
\`\`\`

Use o painel Cloudflare ou o Wrangler para cadastrar LICENSE_ADMIN_TOKEN, PADDLE_API_KEY e PADDLE_WEBHOOK_SECRET como secrets. Nunca coloque esses valores em vars no wrangler.jsonc.

## Rotação

- Cada chave possui um key_id imutável.
- Publicar primeiro uma versão do aplicativo contendo a nova chave pública no dicionário PUBLIC_KEYS.
- Testar a validação local em máquinas limpas e com as duas chaves públicas.
- Somente depois alterar LICENSE_SIGNING_KEY_ID e cadastrar a chave privada correspondente como secret no Worker.
- O servidor assina apenas com a chave ativa; o aplicativo pode continuar verificando as chaves anteriores.
- Uma chave comprometida exige revogação operacional, análise de licenças emitidas, nova chave, atualização do aplicativo e plano de comunicação.
- A perda de uma chave privada não se corrige derivando a chave a partir da pública. Restaura-se o backup criptografado ou gira-se para uma nova chave.

## Proteções operacionais obrigatórias antes de produção

- Criar o D1 de produção e aplicar as migrações em sandbox primeiro.
- Aplicar regra Cloudflare Access ao caminho /api/admin/* e manter o segredo LICENSE_ADMIN_TOKEN como segunda barreira.
- Criar regras de rate limiting para /api/trial/start e /api/checkout/create.
- Criar a chave de API Paddle com permissões mínimas `customer.read`, `customer.write` e `transaction.write`.
- Manter a localização de moeda do Paddle desabilitada no primeiro lançamento, pois o registro atual compara valores na moeda-base USD. Só habilitá-la depois de armazenar e validar o valor/moeda final de cada transação.
- Configurar webhook Paddle somente para os eventos necessários e validar a assinatura, timestamp de 5 segundos e event_id.
- Testar pagamento completo, pagamento recusado, webhook repetido, webhook antigo, valor/currency incorretos, order id incorreto, emissão manual, revogação e conflito de dispositivo.
- Definir o tratamento de reembolso/chargeback para revogação e suporte.
- Configurar alertas para falha de assinatura, indisponibilidade, falha de webhook e anomalias de emissão.
- Usar D1 Time Travel para recuperação operacional de curto prazo e manter exportações periódicas protegidas fora da conta Cloudflare para recuperação de longo prazo.
- Restringir permissões Cloudflare/GitHub por menor privilégio e usar MFA.
- Não registrar payloads que contenham tokens, chaves, segredos ou dados pessoais desnecessários.

## Limites conhecidos

- O Device ID atual combina nome do computador e endereço MAC local. Ele é um identificador prático, não uma prova criptográfica inviolável de hardware. A versão futura deverá avaliar uma identidade de instalação com chave local protegida pelo Windows DPAPI e procedimento de transferência/reinstalação.
- A licença assinada offline pode ser copiada, mas só valida no dispositivo cujo ID está no payload. O aplicativo consulta o serviço e utiliza concessão offline assinada por até sete dias; depois desse prazo precisa reconectar. A identificação atual ainda depende de nome do computador e MAC, portanto não é resistência criptográfica forte à clonagem.
- A avaliação gratuita deve ser confirmada pelo servidor e protegida por rate limiting; o estado local atual não é suficiente para a oferta comercial.
- A interface Windows agora inclui fluxo de checkout e verificação do pagamento na branch de desenvolvimento; a integração só poderá ser considerada concluída depois de testes ponta a ponta contra uma API de staging realmente implantada.
- Esta base ainda requer política de reembolsos, testes E2E e aprovação comercial do Paddle.

## Backups D1

Cloudflare D1 Time Travel oferece recuperação point-in-time por até 30 dias segundo a documentação atual. Não substitui backups de longo prazo fora da conta. Automatize exportações periódicas e teste a restauração.
