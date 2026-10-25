# Fichário de Concurso

Flashcards para concurso, gratuitos, no navegador do celular ou do computador.

- Cartas de **certo ou errado** (estilo Cebraspe), **múltipla escolha A–E**, **lacuna** com resposta digitada e **frente e verso**.
- Editor com negrito, marca-texto, cores, listas e imagens, mais comentário e etiquetas.
- Revisão espaçada (Errei / Difícil / Bom / Fácil), sequência de dias e taxa de acerto.
- Login com e-mail e senha ou Google. Cada pessoa tem os próprios baralhos.
- **Baralhos compartilhados**: quem cria passa o código, os outros entram com ele e todos estudam as mesmas cartas, cada um com a própria revisão.
- Importa e exporta planilha CSV (`baralho;tipo;frente;verso;alternativas;gabarito;comentario;etiquetas`) e texto do Anki.
- Instalável como app (PWA) e abre sem internet depois do primeiro acesso.

## Como funciona

Site estático (GitHub Pages) + Firebase (Authentication e Firestore, plano gratuito).

| Arquivo | Para que serve |
| --- | --- |
| `index.html` | O app inteiro |
| `firebase-config.js` | Dados do projeto Firebase |
| `firestore.rules` | Regras de segurança, para colar em Firestore > Regras |
| `sw.js`, `manifest.webmanifest`, ícones | Instalação como app e uso offline |

## Configuração no Firebase

1. Authentication: ativar **E-mail/senha** e **Google**. Em Configurações > Domínios autorizados, adicionar o domínio do GitHub Pages.
2. Firestore Database: criar o banco e colar o conteúdo de `firestore.rules` na aba **Regras**.
