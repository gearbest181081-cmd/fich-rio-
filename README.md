# Fichário de Concurso

Flashcards para concurso, gratuitos, no navegador do celular ou do computador.

- Cartas de **certo ou errado** (estilo Cebraspe), **múltipla escolha A–E**, **lacuna** com resposta digitada e **frente e verso**.
- Editor com negrito, marca-texto, cores, listas e imagens, mais comentário e etiquetas.
- Revisão espaçada (Errei / Difícil / Bom / Fácil), sequência de dias e taxa de acerto.
- Login com e-mail e senha ou Google. Cada pessoa tem os próprios baralhos.
- **Baralhos compartilhados**: quem cria passa o código, os outros entram com ele e todos estudam as mesmas cartas, cada um com a própria revisão.
- **Simulado** com tempo de prova, montado com as matérias que a pessoa escolher, nota por matéria e correção com comentários.
- **Desempenho**: acerto e tempo médio por matéria, sequência de dias e histórico de simulados.
- **Importa questões de PDF** (com texto ou escaneado), com gabarito na própria prova ou em outro arquivo, e separa por matéria.
- Importa e exporta planilha CSV (`baralho;tipo;frente;verso;alternativas;gabarito;comentario;etiquetas`) e texto do Anki.
- Instalável como app (PWA) e abre sem internet depois do primeiro acesso.

## Como funciona

Site estático (GitHub Pages) + Firebase (Authentication e Firestore, plano gratuito).

| Arquivo | Para que serve |
| --- | --- |
| `index.html` | A página: estrutura, visual e a política de segurança de conteúdo (CSP) |
| `app.js` | O app: telas, estudo, simulado, baralhos compartilhados e acesso ao Firebase |
| `pdf-import.js` | Leitura de questões de PDF |
| `vendor/` | Bibliotecas servidas pelo próprio site: pdf.js 4.10.38, tesseract.js 5.1.1 (páginas escaneadas) e o SDK do Firebase 10.12.2 |
| `firebase-config.js` | Dados do projeto Firebase |
| `firestore.rules`, `firebase.json` | Regras de segurança do Firestore e a configuração para publicá-las |
| `sw.js`, `manifest.webmanifest`, ícones | Instalação como app e uso offline |

## Configuração no Firebase

1. Authentication: ativar **E-mail/senha** e **Google**. Em Configurações > Domínios autorizados, adicionar o domínio do GitHub Pages.
2. Firestore Database: criar o banco e colar o conteúdo de `firestore.rules` na aba **Regras** (ou, com o Firebase CLI, `firebase deploy --only firestore:rules`). Sempre que esse arquivo mudar, publicar de novo.
3. Opcional, para ninguém de fora criar conta: depois que todo mundo tiver conta, em Authentication > Configurações > Ações do usuário, desmarcar **Ativar criação (inscrição)**. Para liberar alguém novo, marque de novo por um instante ou crie a conta em Authentication > Usuários.
4. Manter o projeto no plano gratuito (Spark). Assim, se alguém abusar, o pior que acontece é o app parar até o dia seguinte, sem cobrança.
5. No Google Cloud (APIs e serviços > Credenciais), restringir a chave de API do navegador aos sites `gearbest181081-cmd.github.io/*`, `fichario-ec3ed.firebaseapp.com/*` (sem ele o login com Google para de funcionar) e `localhost`, e às APIs Identity Toolkit, Token Service e Cloud Firestore.

## Segurança

- Cada pessoa só lê e grava os próprios dados (regras do Firestore). A chave em `firebase-config.js` é pública por natureza; quem protege os dados são as regras.
- Baralhos compartilhados: só entra quem tem o código. Quem criou pode remover alguém, e essa pessoa não volta com o código até ser liberada. Ninguém mais coloca ou tira pessoas, troca o dono ou mexe no nome dos outros.
- O servidor confere cada carta compartilhada: só os campos do app, com tipo e tamanho certos, e o autor é sempre quem grava.
- O conteúdo das cartas compartilhadas é limpo antes de aparecer (só formatação básica e imagens). Alternativas e etiquetas são sempre tratadas como texto.
- A página só roda scripts do próprio site e o do login do Google (CSP em `index.html`). Se um dia ligar outro serviço do Google no login, como o reCAPTCHA, a CSP precisa liberar o endereço dele.
- O leitor de PDF usa o pdf.js 4.10.38 com `isEvalSupported: false`, a correção do alerta CVE-2024-4367.
- Sair da conta apaga as cartas guardadas no aparelho, depois de enviar as mudanças pendentes.
