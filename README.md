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
| `index.html` | O app inteiro |
| `pdf-import.js`, `vendor/` | Leitura de PDF (pdf.js) e de páginas escaneadas (tesseract.js) |
| `firebase-config.js` | Dados do projeto Firebase |
| `firestore.rules` | Regras de segurança, para colar em Firestore > Regras |
| `sw.js`, `manifest.webmanifest`, ícones | Instalação como app e uso offline |

## Configuração no Firebase

1. Authentication: ativar **E-mail/senha** e **Google**. Em Configurações > Domínios autorizados, adicionar o domínio do GitHub Pages.
2. Firestore Database: criar o banco e colar o conteúdo de `firestore.rules` na aba **Regras**. Sempre que esse arquivo mudar, colar de novo.
3. Opcional, para ninguém de fora criar conta: depois que todo mundo tiver conta, em Authentication > Configurações > Ações do usuário, desmarcar **Ativar criação (inscrição)**. Para liberar alguém novo, marque de novo por um instante ou crie a conta em Authentication > Usuários.
4. Manter o projeto no plano gratuito (Spark). Assim, se alguém abusar, o pior que acontece é o app parar até o dia seguinte, sem cobrança.

## Segurança

- Cada pessoa só lê e grava os próprios dados (regras do Firestore). A chave em `firebase-config.js` é pública por natureza; quem protege os dados são as regras.
- Baralhos compartilhados: só entra quem tem o código. Um membro não consegue colocar ou tirar outras pessoas, trocar o dono nem mexer no nome dos outros.
- O conteúdo das cartas compartilhadas é limpo antes de aparecer (só formatação básica e imagens), para ninguém conseguir rodar código no aparelho dos outros.
