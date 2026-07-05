// ═══════════════════════════════════════════════════════════════
//  i18n.js — Sistema de Tradução (PT-PT ↔ EN)
//  Jogos com Eles
//
//  • Default: Português de Portugal (pt-PT)
//  • Strings UI estáticas: dicionário hardcoded (rápido, offline)
//  • Conteúdo dinâmico (summaries, géneros, etc.): Google Translate
//    via backend proxy /api/translate (com cache em memória)
//  • Persistência: localStorage (jce_lang)
//  • API pública exposta em window.i18n
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────
  const LANG_KEY = "jce_lang";
  const SUPPORTED = ["pt", "en"];
  const DEFAULT_LANG = "en"; // English é o idioma padrão

  // ─────────────────────────────────────────────
  //  DICT — UI strings (PT-PT ↔ EN)
  //  Keys são em PT-PT; o valor é a tradução EN.
  //  Em modo EN: t() devolve o valor (tradução EN).
  //  Em modo PT: t() devolve a key (PT original).
  //
  //  Em modo EN não há chamadas ao Google Translate:
  //  os dados do IGDB já vêm em inglês, e as strings
  //  estáticas usam este dicionário (lookup instantâneo).
  // ─────────────────────────────────────────────
  const DICT = {
    // ── Título & meta ───────────────────────────
    "Jogos com Eles": "Games with Them",

    // ── Loader ──────────────────────────────────
    "A carregar jogos...": "Loading games...",
    "A iniciar...": "Starting up...",
    "A preparar...": "Preparing...",
    "Quase...": "Almost there...",

    // ── Empty / loading states ──────────────────
    "Ainda não há jogos na lista.": "No games in the list yet.",

    // ── Admin panel ─────────────────────────────
    "Modo Administrador": "Administrator Mode",
    "Pesquisar Jogo": "Search Game",
    "Nome do jogo...": "Game name...",
    "Na lista": "In the list",
    "Nenhum jogo adicionado ainda.": "No games added yet.",
    "Forçar Loading": "Force Loading",
    "A Forçar Loading...": "Forcing Loading...",
    "Nenhum resultado encontrado.": "No results found.",
    "Erro ao pesquisar. Verifica as credenciais IGDB.":
      "Search failed. Check the IGDB credentials.",
    "A pesquisar...": "Searching...",
    "+ Adicionar": "+ Add",
    "✓ Adicionado": "✓ Added",
    "A adicionar...": "Adding...",
    "Jogo adicionado com sucesso!": "Game added successfully!",
    "Erro ao adicionar jogo.": "Failed to add game.",
    "Jogo removido.": "Game removed.",
    "Erro ao remover jogo.": "Failed to remove game.",
    "Key art atualizada.": "Key art updated.",
    "Erro ao atualizar key art.": "Failed to update key art.",
    "Sem imagens disponíveis.": "No images available.",
    "Remover": "Remove",
    "Erro ao criar tab.": "Failed to create tab.",
    "Erro ao apagar tab.": "Failed to delete tab.",
    "Erro ao guardar jogos da tab:": "Failed to save tab games:",

    // ── Tabs ────────────────────────────────────
    "Todos": "All",
    "Criar_Tab": "Create_Tab",
    "Nome da tab...": "Tab name...",
    "Apagar tab": "Delete tab",

    // ── Tag filter ──────────────────────────────
    "Filtrar": "Filter",
    "Géneros & Temas": "Genres & Themes",
    "Estado de Lançamento": "Release Status",
    "Limpar": "Clear",

    // ── Discover button ─────────────────────────
    "Descobre": "Discover",
    "Novidade": "New",

    // ── Settings (gear menu) ────────────────────
    "Aspeto": "Appearance",
    "Fundo": "Background",
    "Desfoque de fundo": "Background blur",
    "Idioma": "Language",
    "Português": "Portuguese",
    "Inglês": "English",
    "Off": "Off",

    // ── Sort buttons ────────────────────────────
    "Aleatório": "Random",
    "A–Z": "A–Z",
    "Nota": "Rating",
    "Ordem aleatória": "Random order",
    "Ordenar por nome": "Sort by name",
    "Ordenar por nota": "Sort by rating",

    // ── View modes ──────────────────────────────
    "Grelha (4 col)": "Grid (4 cols)",
    "Grelha (5 col)": "Grid (5 cols)",
    "Compacto (6 col)": "Compact (6 cols)",

    // ── Card / modal ────────────────────────────
    "Ver detalhes de": "View details of",
    "Remover jogo": "Remove game",
    "Adicionar a tab": "Add to tab",
    "Editar key art": "Edit key art",
    "Anterior": "Previous",
    "Próximo": "Next",
    "Screenshot": "Screenshot",
    "Copiar nome do jogo": "Copy game name",
    "Expandir descrição": "Expand description",
    "Sem descrição disponível.": "No description available.",
    "Escolher Key Art": "Choose Key Art",
    "Adicionar a Tab": "Add to Tab",
    "Ecrã inteiro": "Fullscreen",
    "Ver no YouTube": "Watch on YouTube",

    // ── Playlist / Gravações ────────────────────
    "Gravações": "Recordings",
    "Link da playlist do YouTube": "YouTube playlist link",
    "Gravações guardadas.": "Recordings saved.",
    "Gravações removidas.": "Recordings removed.",
    "Erro ao guardar gravações.": "Failed to save recordings.",
    "Insere um link de playlist.": "Enter a playlist link.",
    "Link de playlist inválido.": "Invalid playlist link.",

    // ── Extra info labels (modal) ───────────────
    "Estúdio": "Studio",
    "Desenvolvedor": "Developer",
    "Data de lançamento": "Release date",
    "Estado de lançamento": "Release status",
    "Último update": "Last update",
    "Engine": "Engine",
    "Linguagem": "Language",
    "Géneros": "Genres",
    "Não disponível": "Not available",

    // ── Add-to-tab modal ────────────────────────
    "Nenhuma tab criada ainda.\nCria uma tab primeiro.":
      "No tabs created yet.\nCreate a tab first.",

    // ── Registration & Search (header) ──────────
    "Registar": "Sign Up",
    "Pesquisar jogos...": "Search games...",
    "Regista-te primeiro para pesquisar.": "Sign up first to search.",
    "Regista-te primeiro para votar.": "Sign up first to vote.",
    "Nome (máx 8)...": "Name (max 8)...",
    "Nome já existe.": "Name already exists.",
    "Código admin já utilizado.": "Admin code already used.",
    "Nome muito curto (mín 2 caracteres).": "Name too short (min 2 chars).",
    "Nome muito curto.": "Name too short.",
    "Bem-vindo,": "Welcome,",
    "Bem-vindo de volta,": "Welcome back,",
    "Erro ao atualizar nome.": "Failed to update name.",
    "Erro ao registar.": "Registration failed.",
    "Servidor não responde.": "Server not responding.",
    "Erro ao criar tab.": "Failed to create tab.",
    "Erro ao apagar tab.": "Failed to delete tab.",
    "Erro ao guardar jogos da tab:": "Failed to save tab games:",
    "A pesquisar...": "Searching...",
    "Nenhum resultado.": "No results.",
    "Nenhum resultado encontrado.": "No results found.",
    "Erro ao pesquisar. Verifica as credenciais IGDB.": "Search failed. Check the IGDB credentials.",
    "+ Adicionar": "+ Add",
    "✓ Adicionado": "✓ Added",
    "A adicionar...": "Adding...",
    "Jogo adicionado com sucesso!": "Game added successfully!",
    "Erro ao adicionar jogo.": "Failed to add game.",
    "Jogo removido.": "Game removed.",
    "Erro ao remover jogo.": "Failed to remove game.",
    "Key art atualizada.": "Key art updated.",
    "Erro ao atualizar key art.": "Failed to update key art.",
    "Sem imagens disponíveis.": "No images available.",
    "Tab criada (modo demo).": "Tab created (demo mode).",
    "Demo: não é possível adicionar jogos sem Firebase.": "Demo: cannot add games without Firebase.",
    "Já na lista": "Already in list",
    "Enter para confirmar": "Enter to confirm",
    "Conta": "Account",
    "Editar nome": "Edit name",
    "Nome atualizado!": "Name updated!",
    "Novo nome...": "New name...",
    "Guardar": "Save",
    "Jogo adicionado por": "Game added by",
    "Jogo não encontrado.": "Game not found.",
    "Jogo adicionado!": "Game added!",
    "Erro ao adicionar.": "Failed to add.",
    "Erro ao votar.": "Failed to vote.",
    "Remover": "Remove",

    // ── Admin / Reprovados (tab de jogos rejeitados) ──
    "Apenas o admin pode limpar Reprovados.": "Only admin can clear Rejected.",
    "Não há Reprovados para limpar.": "No Rejected to clear.",
    "Reprovados está vazio.": "Rejected is empty.",
    "Reprovados limpo!": "Rejected cleared!",
    "Erro ao limpar Reprovados.": "Failed to clear Rejected.",
    "Apenas o admin pode criar Reprovados.": "Only admin can create Rejected.",
    "Reprovados já existe.": "Rejected already exists.",
    "Reprovados criado!": "Rejected created!",
    "Erro ao criar Reprovados.": "Failed to create Rejected.",

    // ── Game approval (online play) ─────────────
    "Jogo rejeitado:": "Game rejected:",
    "Este jogo não tem multiplayer online.": "This game has no online multiplayer.",
    "Apenas jogos com online play são permitidos.": "Only online play games are allowed.",

    // ── Down-vote & Up-vote system ──────────────
    "Reprovados": "Rejected",
    "Aprovados": "Approved",
    "Criar Reprovados": "Create Rejected",
    "Limpar Reprovados": "Clear Rejected",
    "Confirmar limpeza do lixo?": "Confirm cleanup?",
    "Votar a favor": "Up-vote",
    "Votar contra": "Down-vote",

    // ── Jogados (played) system ─────────────────
    "Jogados": "Played",
    "Marcar como jogado": "Mark as played",
    "Reverter": "Revert",
    "Marcado como jogado.": "Marked as played.",
    "Jogo revertido.": "Game reverted.",
    "Erro ao criar Jogados.": "Failed to create Played.",

    // ── Notificações ───────────────────────────
    "Notificações": "Notifications",
    "Sem notificações.": "No notifications.",
    "Notificações de teste adicionadas.": "Test notifications added.",
    "Limpar tudo": "Clear all",
    "Mutar notificações": "Mute notifications",
    "Mutar sons": "Mute sounds",
    "Computador": "Computer",
    "Sem sinal": "NO SIGNAL",
    "Testes": "Testing",
    "Simular notificações": "Simulate notifications",
    "Alguém": "Someone",
    "data de lançamento": "release date",

    "Remover voto": "Remove vote",
    "votos contra": "down-votes",
    "votos a favor": "up-votes",
    "Upvotes": "Upvotes",
    "Downvotes": "Downvotes",
    "Grupo completo": "Group full",
    "Mais votados": "Most up-votes",
    "Menos votados": "Most down-votes",
    "Mais up-votes": "Most up-votes",
    "Mais down-votes": "Most down-votes",
    "Votos": "Votes",
    "Nenhum voto": "No votes",
    "Jogos em comum": "Games in common",
    "Nenhum outro utilizador registado.": "No other users registered.",
    "Opções": "Options",
    "Mostrar jogos escondidos": "Show hidden games",
    "YouTube autoplay": "YouTube autoplay",

    // ── Release statuses (IGDB status enum) ─────
    "Lançado": "Released",
    "Alpha": "Alpha",
    "Beta": "Beta",
    "Acesso Antecipado": "Early Access",
    "Offline": "Offline",
    "Cancelado": "Cancelled",
    "Rumor": "Rumoured",
    "Removido de venda": "Delisted",
    "Por lançar": "Unreleased",

    // ── Steam review_score_desc (Etapa 4) ───────
    // Tradução dos descritores de análise da Steam.
    // Em PT usamos forma feminina (as análises); em EN mantemos o original da Steam.
    // Keys em PT = o que o t() devolve em modo PT; valor EN = tradução.
    "Esmagadoramente Positivas": "Overwhelmingly Positive",
    "Muito Positivas": "Very Positive",
    "Maioritariamente Positivas": "Mostly Positive",
    "Positivas": "Positive",
    "Misturadas": "Mixed",
    "Negativas": "Negative",
    "Maioritariamente Negativas": "Mostly Negative",
    "Muito Negativas": "Very Negative",
    "Esmagadoramente Negativas": "Overwhelmingly Negative",
    "Sem análises": "No user reviews",
    "análises": "reviews",

    // ── Discover ────────────────────────────────
    "Nenhum jogo disponível para descobrir.": "No games available to discover.",

    // ── Diversos (consistência i18n) ────────────
    "Jogo #": "Game #",
    "jogos": "games",
    "Scroll: zoom · Arrastar: mover · Duplo clique: reset · Esc: fechar":
      "Scroll: zoom · Drag: pan · Double-click: reset · Esc: close",
    "Conteúdo com restrição de idade": "Age-restricted content",
    "Apagar a tab \"{0}\"?": "Delete tab \"{0}\"?",
    "Jogo desconhecido": "Unknown game",
    "estúdio, engine": "studio, engine",
    " em acesso antecipado": " in early access",

    // ── Templates de notificação (placeholders {0}, {1}, ...) ──
    // Usados via tf(). {0} = nome do jogo, {1} = variável contextual.
    "\"{0}\" foi adicionado à lista!": "\"{0}\" was added to the list!",
    "\"{0}\" saiu de acesso antecipado e foi lançado!": "\"{0}\" left early access and is now released!",
    "\"{0}\" foi lançado{1}!": "\"{0}\" was released{1}!",
    "\"{0}\" foi lançado em acesso antecipado!": "\"{0}\" was released in early access!",
    "\"{0}\" recebeu um update! ({1})": "\"{0}\" received an update! ({1})",
    "\"{0}\" teve informações atualizadas: {1}.": "\"{0}\" was updated: {1}.",
    "{0} deu um up-vote em \"{1}\".": "{0} up-voted \"{1}\".",
    "Recebeste {0} up-votes em \"{1}\".": "You received {0} up-votes on \"{1}\".",
    "{0} deu um down-vote em \"{1}\".": "{0} down-voted \"{1}\".",
    "Recebeste {0} down-votes em \"{1}\".": "You received {0} down-votes on \"{1}\".",

    // ── Confirm dialogs ─────────────────────────
    "Apagar a tab": "Delete tab",
    "?": "?",

    // ═══════════════════════════════════════════════
    //  COMPUTADOR CRT (computer.js + apps.js + window.js)
    // ═══════════════════════════════════════════════

    // ── Win95 window manager (window.js) ──
    "Minimizar": "Minimize",
    "Fechar": "Close",
    "Janela": "Window",

    // ── Notepad (apps.js) ──
    "Bloco de Notas": "Notepad",
    "Sem título - Bloco de Notas": "Untitled - Notepad",
    "Ficheiro  Editar  Procurar  Ajuda": "File  Edit  Search  Help",

    // ── MS-DOS (apps.js) ──
    "Linha de comandos CN-DOS": "CN-DOS Prompt",
    "Versão CN-DOS 3.11": "CN-DOS Version 3.11",
    "(c) Copyright CASA•NORTE Systems Inc. 1995": "(c) Copyright CASA•NORTE Systems Inc. 1995",
    "Comandos disponíveis:": "Available commands:",
    "  DIR      Listar conteúdo do diretório": "  DIR      List directory contents",
    "  CLS      Limpar ecrã": "  CLS      Clear screen",
    "  ECHO     Mostrar mensagem": "  ECHO     Display message",
    "  VER      Mostrar versão CN-DOS": "  VER      Show CN-DOS version",
    "  DATE     Mostrar data atual": "  DATE     Show current date",
    "  TIME     Mostrar hora atual": "  TIME     Show current time",
    "  HELP     Mostrar esta ajuda": "  HELP     Show this help",
    "Unidade C é CN-HDD": "Volume in drive C is CN-HDD",
    "Diretório de C:\\": "Directory of C:\\",
    "bytes livres": "bytes free",
    "Comando inválido ou ficheiro não existe": "Bad command or file name",

    // ── My Computer (apps.js) ──
    "O Meu Computador": "My Computer",
    "Ficheiro  Editar  Ver  Ajuda": "File  Edit  View  Help",
    "Disquete 3½ (A:)": "3½ Floppy (A:)",
    "Disco Local (C:)": "Local Disk (C:)",
    "CD-ROM (D:)": "CD-ROM (D:)",
    "Painel de Controlo": "Control Panel",

    // ── About (apps.js) ──
    "Sobre CASA•NORTE": "About CASA•NORTE",
    "Sistema CN-DOS CASA•NORTE": "CASA•NORTE CN-DOS System",
    "Versão 3.11": "Version 3.11",
    "© 1995 CASA•NORTE Systems Inc.": "© 1995 CASA•NORTE Systems Inc.",
    "CPU: Pentium-MMX 200MHz": "CPU: Pentium-MMX 200MHz",
    "Memória: 65.536 KB": "Memory: 65,536 KB",
    "Ecrã: ColorMonitor CN-1530": "Display: CN-1530 ColorMonitor",

    // ── Recycle Bin (apps.js) ──
    "Reciclagem": "Recycle Bin",
    "A Reciclagem está vazia.": "The Recycle Bin is empty.",
    "0 objeto(s)": "0 object(s)",

    // ── Media Player (apps.js) ──
    "Reprodutor CN Media": "CN Media Player",
    "Lista de reprodução": "Playlist",
    "Sem faixa": "— No track —",
    "Próxima:": "Next:",
    "Próxima: — (fim da lista)": "Next: — (end of queue)",
    "Anterior": "Previous",
    "Tocar": "Play",
    "Pausa": "Pause",
    "Seguinte": "Next",
    "Aleatório": "Scramble",
    "Aleatório (fila random)": "Scramble (random queue)",
    "Repetir": "Repeat",
    "Volume": "Volume",
    // ── Media Player: YouTube playlists (apps.js) ──
    "Adicionar Playlist": "Add Playlist",
    "Nome da playlist": "Playlist name",
    "URL do YouTube (playlist ou vídeo)": "YouTube URL (playlist or video)",
    "Adicionar": "Add",
    "Remover playlist": "Remove playlist",
    "Playlist padrão": "Default playlist",
    "Minhas Playlists": "My Playlists",
    "URL inválida": "Invalid URL",
    "Playlist adicionada!": "Playlist added!",
    "Erro ao adicionar playlist": "Failed to add playlist",

    // ── Display Properties (apps.js) ──
    "Propriedades de Visualização": "Display Properties",
    "Fundo de ecrã": "Background",
    "Padrão:": "Pattern:",
    "Antevisão": "Preview",
    "Proteção de ecrã:": "Screen Saver:",
    "Proteção de ecrã": "Screen Saver",
    "Esperar:": "Wait:",
    "minutos": "minutes",
    "Antevisão": "Preview",
    "Aparência": "Appearance",
    "Definições avançadas": "Advanced settings",
    "Definições de aparência": "Appearance settings",
    "3D Starfield": "3D Starfield",
    "Janelas Voadoras": "Flying Windows",
    "Ecrã vazio": "Blank Screen",

    // ── Sound Properties (apps.js) ──
    "Propriedades de Som": "Sound Properties",
    "Volume principal:": "Master Volume:",
    "Silenciar sons ambiente": "Mute ambient sounds",
    "Silenciar som de click de fundo": "Mute background click sound",
    "Sons": "Sounds",
    "Áudio": "Audio",

    // ── Start Menu (apps.js) ──
    "Programas": "Programs",
    "Definições": "Settings",
    "Executar...": "Run...",
    "Desligar...": "Shut Down...",
    "Ajuda": "Help",

    // ── Botões OK/Cancel/Apply ──
    "OK": "OK",
    "Cancelar": "Cancel",
    "Aplicar": "Apply",

    // ═══════════════════════════════════════════════
    //  BRICK BREAKER (brickbreaker.js)
    // ═══════════════════════════════════════════════

    // ── Menu principal ──
    "JOGAR": "PLAY",
    "LOJA": "SHOP",
    "TABELA DE PONTUAÇÕES": "LEADERBOARD",
    "COMO JOGAR": "HOW TO PLAY",
    "OPÇÕES": "OPTIONS",

    // ── How to Play ──
    "Mover plataforma:": "Move paddle:",
    "Rato ou setas ← →": "Mouse or ← → arrows",
    "Lançar bola:": "Launch ball:",
    "Espaço ou Clique": "Space or Click",
    "Pausa:": "Pause:",
    "Sair:": "Quit:",
    "Esc (em pausa)": "Esc (from pause)",
    "Vidas:": "Lives:",
    "Não deixes todas as bolas cair!": "Don't let all balls fall!",
    "Power-ups:": "Power-ups:",
    "Apanha cápsulas que caem — drops raros dos tijolos": "Catch falling capsules — rare drops from bricks",
    "Alargar · Lento · Escudo · Laser · Atravessar · Multi": "Wide · Slow · Shield · Laser · Pierce · Multi",
    "Vida Extra (raro, 3%) — acumula e é consumida na próxima morte": "Extra Life (rare, 3%) — stacks and is consumed on next death",
    "Vida Extra (10%) — acumula e é consumida na próxima morte": "Extra Life (10%) — stacks and is consumed on next death",
    "Granada (10%) — explode 5 tijolos (por bola, não por tempo)": "Grenade (10%) — explodes 5 bricks (per ball, not time-based)",
    "Nuke (5%) — limpa o nível completo instantaneamente": "Nuke (5%) — clears the entire level instantly",
    "Velocidade:": "Speed:",
    "Aumenta a cada nível, cap no nível 10": "Rises each level, caps at level 10",
    "Moedas:": "Coins:",
    "Ganhas com a pontuação (50 pts = 1 moeda) — gasta na LOJA": "Earned from score (50 pts = 1 coin) — spend in the SHOP",
    "Loja:": "Shop:",
    "Compra e equipa skins para tijolos, bola, plataforma e fundo": "Buy & equip skins for bricks, ball, paddle, and background",
    "Limpa todos os tijolos": "Clear all bricks",
    "para avançar — padrões infinitos": "to advance — infinite patterns",

    // ── Options ──
    "Efeitos sonoros": "Sound effects",

    // ── Shop ──
    "TIJOLOS": "BRICKS",
    "BOLA": "BALL",
    "PLATAFORMA": "PADDLE",
    "FUNDO": "BACKGROUND",
    "EQUIPADO": "EQUIPPED",
    "DESEQUIPAR": "UNEQUIP",
    "EQUIPAR": "EQUIP",
    "VOLTAR": "BACK",

    // ── Leaderboard ──
    "MELHOR:": "MY BEST:",
    "#": "#",
    "NOME": "NAME",
    "NÍVEL": "LV",
    "PONTUAÇÃO": "SCORE",
    "A carregar...": "Loading...",
    "Sem pontuações ainda. Sê o primeiro!": "No scores yet. Be the first!",

    // ── HUD / jogo ──
    "PONTOS": "SCORE",
    "NÍVEL": "LV",
    "RATO / ← → MOVER · ESPAÇO LANÇAR · P PAUSA": "MOUSE / ← → MOVE · SPACE LAUNCH · P PAUSE",

    // ── Pausa ──
    "EM PAUSA": "PAUSED",
    "RETOMAR": "RESUME",
    "SAIR PARA O MENU": "QUIT TO MENU",

    // ── Game over ──
    "FIM DE JOGO": "GAME OVER",
    "PONTUAÇÃO FINAL": "FINAL SCORE",
    "MOEDAS GANHAS": "COINS EARNED",
    "JOGAR DE NOVO": "PLAY AGAIN",
    "MENU PRINCIPAL": "MAIN MENU",

    // ── Debug ──
    "DEBUG · escreve \"test\" para alternar": "DEBUG · type \"test\" to toggle",
    "LARGO": "WIDE",
    "LENTO": "SLOW",
    "ESCUDO": "SHIELD",
    "PIERCE": "PIERCE",
    "SALTAR NÍVEL": "SKIP LV",
    "MORRER": "DIE",
    "DESBLOQUEAR TUDO": "UNLOCK ALL",
    "RESET $": "RESET $",
    "FECHAR": "CLOSE",

    // ── Game over coins ──
    "(regista-te para guardar)": "(register to save)",
  };

  // ─────────────────────────────────────────────
  //  GLOSSÁRIO — termos IGDB frequentes
  //  (tradução instantânea, sem chamada à API)
  //  PT-PT primeiro; valor EN.
  //  Nota: para PT-PT, mantemos o original IGDB (que é EN) só se
  //  a tradução PT fizer sentido; caso contrário fica EN.
  // ─────────────────────────────────────────────
  const GLOSSARY = {
    // Géneros comuns
    "Role-playing (RPG)": { pt: "Role-playing (RPG)", en: "Role-playing (RPG)" },
    "Real Time Strategy (RTS)": { pt: "Estratégia em tempo real (RTS)", en: "Real Time Strategy (RTS)" },
    "Turn-based strategy (TBS)": { pt: "Estratégia por turnos (TBS)", en: "Turn-based strategy (TBS)" },
    "Shooter": { pt: "Tiro", en: "Shooter" },
    "Adventure": { pt: "Aventura", en: "Adventure" },
    "Platform": { pt: "Plataformas", en: "Platform" },
    "Puzzle": { pt: "Puzzle", en: "Puzzle" },
    "Racing": { pt: "Corrida", en: "Racing" },
    "Simulator": { pt: "Simulador", en: "Simulator" },
    "Sport": { pt: "Desporto", en: "Sport" },
    "Strategy": { pt: "Estratégia", en: "Strategy" },
    "Tactical": { pt: "Tático", en: "Tactical" },
    "Hack and slash/Beat 'em up": { pt: "Hack and slash/Beat 'em up", en: "Hack and slash/Beat 'em up" },
    "Indie": { pt: "Indie", en: "Indie" },
    "Arcade": { pt: "Arcada", en: "Arcade" },
    "Point-and-click": { pt: "Apontar e clicar", en: "Point-and-click" },
    "Music": { pt: "Música", en: "Music" },
    "Quiz/Trivia": { pt: "Quiz/Trivial", en: "Quiz/Trivia" },
    "MOBA": { pt: "MOBA", en: "MOBA" },
    "Card & Board Game": { pt: "Cartas e Tabuleiro", en: "Card & Board Game" },
    "Visual Novel": { pt: "Novela Visual", en: "Visual Novel" },

    // Temas
    "Action": { pt: "Ação", en: "Action" },
    "Fantasy": { pt: "Fantasia", en: "Fantasy" },
    "Science fiction": { pt: "Ficção científica", en: "Science fiction" },
    "Horror": { pt: "Terror", en: "Horror" },
    "Thriller": { pt: "Suspense", en: "Thriller" },
    "Survival": { pt: "Sobrevivência", en: "Survival" },
    "Historical": { pt: "Histórico", en: "Historical" },
    "Stealth": { pt: "Furtividade", en: "Stealth" },
    "Comedy": { pt: "Comédia", en: "Comedy" },
    "Business": { pt: "Negócios", en: "Business" },
    "Drama": { pt: "Drama", en: "Drama" },
    "Erotic": { pt: "Erótico", en: "Erotic" },
    "Mystery": { pt: "Mistério", en: "Mystery" },
    "Romance": { pt: "Romance", en: "Romance" },
    "Sandbox": { pt: "Sandbox", en: "Sandbox" },
    "Open world": { pt: "Mundo aberto", en: "Open world" },
    "Warfare": { pt: "Guerra", en: "Warfare" },
    "4X (explore, expand, exploit, and exterminate)": {
      pt: "4X (explorar, expandir, explorar e exterminar)",
      en: "4X (explore, expand, exploit, and exterminate)",
    },
    "Educational": { pt: "Educativo", en: "Educational" },
    "Kids": { pt: "Infantil", en: "Kids" },
    "Mature": { pt: "Adulto", en: "Mature" },
    "Party": { pt: "Festa", en: "Party" },
    "Trivia": { pt: "Trivial", en: "Trivia" },
    "Turn-based": { pt: "Por turnos", en: "Turn-based" },
    "Side view": { pt: "Vista lateral", en: "Side view" },
    "Top-down": { pt: "Vista de cima", en: "Top-down" },

    // Modos de jogo
    "Single player": { pt: "Um jogador", en: "Single player" },
    "Multiplayer": { pt: "Multijogador", en: "Multiplayer" },
    "Co-operative": { pt: "Cooperativo", en: "Co-operative" },
    "Split screen": { pt: "Ecrã dividido", en: "Split screen" },
    "Massively Multiplayer Online (MMO)": {
      pt: "Massivamente Multijogador Online (MMO)",
      en: "Massively Multiplayer Online (MMO)",
    },
    "Battle Royale": { pt: "Battle Royale", en: "Battle Royale" },
  };

  // ─────────────────────────────────────────────
  //  STATE
  // ─────────────────────────────────────────────
  let currentLang = DEFAULT_LANG;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && SUPPORTED.includes(saved)) currentLang = saved;
  } catch (_) {}

  // Cache de traduções dinâmicas (Google Translate)
  // chave: `${lang}::${text}` → tradução
  const translateCache = new Map();

  // Callbacks a chamar quando o idioma muda (para re-render)
  const langChangeCallbacks = new Set();

  // ─────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────
  function isPt() { return currentLang === "pt"; }

  function applyHtmlLang() {
    document.documentElement.lang = currentLang === "pt" ? "pt-PT" : "en";
  }

  // Traduz uma string estática (procura no DICT; fallback = própria string)
  function t(key) {
    if (key == null) return "";
    const k = String(key);
    if (isPt()) return k;
    return DICT[k] != null ? DICT[k] : k;
  }

  // Traduz um template com placeholders {0}, {1}, ...
  // Ex: tf('"{0}" foi adicionado à lista!', 'Mario')
  //   PT → '"Mario" foi adicionado à lista!'
  //   EN → '"Mario" was added to the list!'
  // Os placeholders são substituídos na ordem dos argumentos.
  function tf(key, ...args) {
    let s = t(key);
    for (let i = 0; i < args.length; i++) {
      s = s.replace(new RegExp("\\{" + i + "\\}", "g"), String(args[i]));
    }
    return s;
  }

  // Traduz um termo do glossário; devolve null se não estiver no glossário
  function glossaryLookup(text) {
    if (text == null) return null;
    const entry = GLOSSARY[String(text).trim()];
    if (!entry) return null;
    return entry[currentLang] || entry.en || text;
  }

  // ─────────────────────────────────────────────
  //  APLICAR TRADUÇÕES AO DOM (data-i18n attrs)
  // ─────────────────────────────────────────────
  function applyTranslations(root) {
    const scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      // Preserva filhos SVG/IMG: substitui só o primeiro text node
      // ou, se o elemento só tiver texto, substitui tudo.
      const firstChild = el.firstChild;
      if (firstChild && firstChild.nodeType === Node.TEXT_NODE && el.childNodes.length === 1) {
        firstChild.nodeValue = val;
      } else if (el.childNodes.length === 0) {
        el.textContent = val;
      } else {
        // Tem filhos não-texto: substitui só o texto leading/trailing
        // Caso típico: <button><svg/>Texto</button>
        let replaced = false;
        for (let i = 0; i < el.childNodes.length; i++) {
          const node = el.childNodes[i];
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
            node.nodeValue = val;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          // Sem text node — acrescenta no fim
          el.appendChild(document.createTextNode(val));
        }
      }
    });

    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });

    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.getAttribute("data-i18n-title"));
    });

    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });

    scope.querySelectorAll("[data-i18n-aria-label-template]").forEach((el) => {
      // Template com variável: usar data-i18n-var="valor"
      const tmpl = el.getAttribute("data-i18n-aria-label-template");
      const variable = el.getAttribute("data-i18n-var") || "";
      el.setAttribute("aria-label", `${t(tmpl)} ${variable}`);
    });
  }

  // ─────────────────────────────────────────────
  //  TRADUÇÃO DINÂMICA (Google Translate)
  //  Usada para summaries, géneros fora do glossário, etc.
  //
  //  Estratégia com fallback em cascata:
  //    1. Glossário (instantâneo, offline)
  //    2. Cache local (evita chamadas repetidas)
  //    3. Backend proxy /api/translate (quando corre via Next.js)
  //    4. Google Translate via proxy CORS (quando corre standalone)
  //    5. MyMemory API directa (CORS-friendly, último recurso)
  //
  //  ⚠️  Em modo EN: NÃO há chamadas ao Google Translate.
  //      Os dados do IGDB já vêm em inglês, e as strings estáticas
  //      usam o DICT (lookup instantâneo). O Google Translate só é
  //      usado para traduzir sumários/tags do EN → PT.
  //
  //  ⚠️  Otimizações anti-spam de consola:
  //      - /api/translate é testado apenas 1 vez; se falhar (404 em
  //        GitHub Pages), não se volta a tentar (flag _apiTranslateAvailable).
  //      - Concorrência limitada: apenas 3 traduções em paralelo (queue).
  //      - Backoff em 429: espera 2s antes de tentar outro proxy.
  //      - Warnings de falha são agrupados (1 por sessão, não por texto).
  // ─────────────────────────────────────────────

  // Flag: se /api/translate já retornou 404, não voltar a tentar
  let _apiTranslateAvailable = true;
  // Flag: se um proxy CORS retornou 429, fazer backoff
  let _proxyBackoffUntil = 0;
  // Conta falhas de tradução para agrupar warnings (evita spam de consola)
  let _translateFailCount = 0;
  let _translateWarned = false;

  // ── Worker proxy para tradução (Cloudflare Worker) ──
  // Usa o MESMO worker do IGDB/Steam (igdb-proxy.dr-mx-droid.workers.dev).
  // O worker chama Google Translate server-side → resolve CORS e rate-limit.
  // Endpoint: GET /translate?text=...&target=pt
  const TRANSLATE_PROXY = "https://igdb-proxy.dr-mx-droid.workers.dev/translate";
  let _translateProxyAvailable = true; // se falhar, faz fallback para outros métodos

  // ── Cache persistente em localStorage ──
  // As traduções são estáticas (um texto traduz-se sempre igual). Persistir
  // em localStorage evita re-traduzir na próxima visita — poupa chamadas API.
  const TRANSLATE_STORAGE_KEY = "jce_translations_v1";
  let _persistentCache = {};
  try {
    const raw = localStorage.getItem(TRANSLATE_STORAGE_KEY);
    if (raw) _persistentCache = JSON.parse(raw);
  } catch (_) { _persistentCache = {}; }

  function _savePersistentCache() {
    try {
      // Limita a 500 entries para não estourar a quota do localStorage
      const keys = Object.keys(_persistentCache);
      if (keys.length > 500) {
        // Remove as 50 mais antigas (não há timestamp, remove do início)
        for (let i = 0; i < 50; i++) delete _persistentCache[keys[i]];
      }
      localStorage.setItem(TRANSLATE_STORAGE_KEY, JSON.stringify(_persistentCache));
    } catch (_) { /* quota cheia — ignora */ }
  }

  // Queue simples para limitar concorrência de traduções a 3 em paralelo.
  // Evita disparar 40+ requests simultâneos aos proxies CORS (causa 429).
  const _MAX_CONCURRENT_TRANSLATIONS = 3;
  let _activeTranslations = 0;
  const _translationQueue = [];

  function _runNextTranslation() {
    if (_activeTranslations >= _MAX_CONCURRENT_TRANSLATIONS) return;
    const next = _translationQueue.shift();
    if (!next) return;
    _activeTranslations++;
    Promise.resolve(next.fn())
      .finally(() => {
        _activeTranslations--;
        _runNextTranslation();
      });
  }

  function _enqueueTranslation(fn) {
    return new Promise((resolve, reject) => {
      _translationQueue.push({ fn: () => Promise.resolve(fn()).then(resolve, reject) });
      _runNextTranslation();
    });
  }

  // ─────────────────────────────────────────────
  //  CHUNKING — divide textos longos para respeitar o limite de 500 chars
  //  do MyMemory API. Divide por frases (".", "!", "?") e agrupa em chunks
  //  menores que maxLen. Cada chunk é traduzido separadamente e os resultados
  //  são juntados com espaços preservando a pontuação original.
  // ─────────────────────────────────────────────
  const MYMEMORY_MAX_CHARS = 450; // margem de segurança sob o limite de 500

  // Divide um texto em chunks de no máximo maxLen chars, cortando em limites
  // de frases (., !, ?) quando possível. Se uma frase individual exceder
  // maxLen, corta-a por espaços (palavras).
  function _splitIntoChunks(text, maxLen) {
    if (!text || text.length <= maxLen) return [text];

    const chunks = [];
    // Primeiro divide por fim de frase (preserva o delimitador)
    const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];

    let current = "";
    for (const sentence of sentences) {
      if (sentence.length > maxLen) {
        // Frase demasiado longa — guarda o current e divide a frase por palavras
        if (current) { chunks.push(current); current = ""; }
        const words = sentence.split(/(\s+)/);
        for (const w of words) {
          if ((current + w).length > maxLen) {
            if (current) chunks.push(current);
            current = w;
          } else {
            current += w;
          }
        }
      } else if ((current + sentence).length > maxLen) {
        // Adicionar a frase excederia o limite — guarda current e começa novo
        if (current) chunks.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  async function translateText(text, targetLang) {
    if (text == null) return "";
    const trimmed = String(text);
    if (!trimmed.trim()) return trimmed;

    const lang = targetLang || currentLang;

    // ⚠️  Em EN: os dados do IGDB já vêm em inglês — devolve as-is.
    //     Zero chamadas a APIs externas.
    if (lang === "en") {
      return trimmed;
    }

    // 1. Glossário (instantâneo) — só para PT
    const glossary = glossaryLookup(trimmed);
    if (glossary != null) return glossary;

    // 2. Cache em memória
    const cacheKey = `${lang}::${trimmed}`;
    if (translateCache.has(cacheKey)) {
      return translateCache.get(cacheKey);
    }

    // 2b. Cache persistente em localStorage (sobrevive entre sessões)
    // Se já traduzimos este texto antes, devolve imediatamente — zero chamadas API.
    if (_persistentCache[cacheKey]) {
      translateCache.set(cacheKey, _persistentCache[cacheKey]); // também em memória
      return _persistentCache[cacheKey];
    }

    // ── CHUNKING: se o texto exceder o limite do MyMemory (500 chars),
    //    divide em chunks e traduz cada um. Isto evita o erro
    //    "QUERY LENGTH LIMIT EXCEEDED" que aparecia em descrições longas.
    if (trimmed.length > MYMEMORY_MAX_CHARS) {
      const chunks = _splitIntoChunks(trimmed, MYMEMORY_MAX_CHARS);
      if (chunks.length > 1) {
        // Traduz cada chunk e junta os resultados
        const translatedChunks = await Promise.all(
          chunks.map(c => translateText(c, lang))
        );
        const joined = translatedChunks.join(" ").replace(/\s+([.,!?;:])/g, "$1");
        translateCache.set(cacheKey, joined);
        return joined;
      }
    }

    // Enfileira a tradução para limitar concorrência
    return _enqueueTranslation(async () => {
      // Re-verifica cache (outra tradução do mesmo texto pode ter terminado)
      if (translateCache.has(cacheKey)) {
        return translateCache.get(cacheKey);
      }
      if (_persistentCache[cacheKey]) {
        translateCache.set(cacheKey, _persistentCache[cacheKey]);
        return _persistentCache[cacheKey];
      }

      let translated = null;

      // 3. Worker proxy (Cloudflare Worker → Google Translate server-side)
      //    PRIMEIRA OPÇÃO: resolve CORS e rate-limit do MyMemory/proxies públicos.
      //    O worker tem cache server-side próprio, por isso traduções repetidas
      //    são instantâneas e não contam para qualquer rate-limit.
      if (_translateProxyAvailable) {
        try {
          const url = `${TRANSLATE_PROXY}?target=${encodeURIComponent(lang)}&text=${encodeURIComponent(trimmed)}`;
          const res = await fetch(url, { method: "GET" });
          if (res.ok) {
            const data = await res.json();
            if (data && data.translatedText) {
              translated = data.translatedText;
            }
          } else if (res.status === 404) {
            // Worker não tem a rota /translate (precisa de deploy atualizado)
            _translateProxyAvailable = false;
          }
        } catch (_) { /* rede — tenta fallback */ }
      }

      // 4. Fallback: backend proxy Next.js (só em dev server)
      if (!translated && _apiTranslateAvailable) {
        try {
          const url = `/api/translate?target=${encodeURIComponent(lang)}&text=${encodeURIComponent(trimmed)}`;
          const res = await fetch(url, { method: "GET" });
          if (res.status === 404) {
            _apiTranslateAvailable = false;
          } else if (res.ok) {
            const data = await res.json();
            if (data && data.translatedText) {
              translated = data.translatedText;
            }
          }
        } catch (_) { /* rede */ }
      }

      // 5. Fallback: Google Translate via proxy CORS público (pouco fiável)
      if (!translated && Date.now() >= _proxyBackoffUntil) {
        translated = await translateViaCorsProxy(trimmed, lang);
      }

      // 6. Fallback final: MyMemory API directa
      if (!translated) {
        translated = await translateViaMyMemory(trimmed, lang);
      }

      if (translated) {
        translateCache.set(cacheKey, translated);
        // Persiste em localStorage para próximas visitas (zero chamadas API)
        _persistentCache[cacheKey] = translated;
        _savePersistentCache();
        return translated;
      }

      // Falhou — agrupa warnings para não spamar a consola
      _translateFailCount++;
      if (!_translateWarned && _translateFailCount >= 3) {
        console.warn(`[i18n] ${_translateFailCount} traduções falharam (worker/proxies indisponíveis ou rate-limited). As traduções serão tentadas novamente mais tarde.`);
        _translateWarned = true;
      }
      return trimmed;
    });
  }

  // Google Translate free endpoint via proxy CORS.
  // Tenta vários proxies por ordem até um funcionar.
  // Se um proxy retornar 429 (rate limit), ativa backoff global.
  async function translateViaCorsProxy(text, lang) {
    const gtUrl =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t` +
      `&q=${encodeURIComponent(text)}`;

    const proxies = [
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    ];

    for (const makeProxyUrl of proxies) {
      try {
        const res = await fetch(makeProxyUrl(gtUrl), { method: "GET" });
        if (res.status === 429) {
          // Rate limited — ativa backoff de 5 segundos para todos os proxies
          _proxyBackoffUntil = Date.now() + 5000;
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        // Resposta: [ [ ["tradução","original",...], ... ], null, "en", ... ]
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const result = data[0]
            .map((seg) =>
              Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""
            )
            .join("");
          if (result && result.trim()) return result;
        }
      } catch (_) { /* tenta próximo proxy */ }
    }
    return null;
  }

  // MyMemory API — gratuita e CORS-friendly.
  // Requer langpair=SOURCE|TARGET; assumimos EN como origem.
  // ⚠️  Limite de 500 chars por pedido. Textos maiores são rejeitados com
  //     "QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS".
  //     O translateText() divide textos longos em chunks antes de chamar isto.
  async function translateViaMyMemory(text, lang) {
    try {
      const url =
        `https://api.mymemory.translated.net/get` +
        `?q=${encodeURIComponent(text)}` +
        `&langpair=en|${encodeURIComponent(lang)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.responseData && data.responseData.translatedText) {
        const t = data.responseData.translatedText;
        // Filtra mensagens de erro/quota do MyMemory
        if (
          t.startsWith("MYMEMORY WARNING") ||
          t === "PLEASE SELECT TWO DISTINCT LANGUAGES" ||
          t.startsWith("INVALID LANGUAGE PAIR") ||
          t.startsWith("QUERY LENGTH LIMIT") ||  // texto > 500 chars
          t.includes("MAX ALLOWED QUERY")
        ) {
          return null;
        }
        return t;
      }
    } catch (_) { /* falha */ }
    return null;
  }

  // Traduz um lote de textos em paralelo (mais eficiente)
  async function translateBatch(texts, targetLang) {
    if (!texts || texts.length === 0) return [];
    const lang = targetLang || currentLang;
    return Promise.all(
      texts.map((txt) => translateText(txt, lang))
    );
  }

  // ─────────────────────────────────────────────
  //  MUDANÇA DE IDIOMA
  // ─────────────────────────────────────────────

  // Actualiza o estado "active" dos botões do selector de idioma
  // para reflectir o idioma actual. Chamada no init e no setLang.
  function updateLangButtonsActive() {
    document.querySelectorAll(".lang-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
    if (lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    applyHtmlLang();
    applyTranslations();
    updateLangButtonsActive();
    // Notifica listeners (app.js re-renderiza)
    langChangeCallbacks.forEach((cb) => {
      try { cb(lang); } catch (e) { console.error("[i18n] listener erro:", e); }
    });
  }

  function onLanguageChange(cb) {
    if (typeof cb === "function") langChangeCallbacks.add(cb);
  }

  function getCurrentLang() { return currentLang; }

  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────
  applyHtmlLang();

  // Expõe API global
  window.i18n = {
    t,
    tf,
    translateText,
    translateBatch,
    setLang,
    getCurrentLang,
    onLanguageChange,
    applyTranslations,
    glossaryLookupSync: glossaryLookup,
    updateLangButtonsActive,
    isPt,
    SUPPORTED,
    DEFAULT_LANG,
  };

  // Aplica traduções + actualiza botões quando o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      applyTranslations();
      updateLangButtonsActive();
    });
  } else {
    applyTranslations();
    updateLangButtonsActive();
  }

  // Liga botões de selector de idioma (delegação de eventos)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".lang-option");
    if (btn && btn.dataset.lang) {
      e.preventDefault();
      e.stopPropagation();
      setLang(btn.dataset.lang);
    }
  });
})();
