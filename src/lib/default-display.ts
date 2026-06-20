import type { LocaleDisplay } from './schemas';

// Shared pt-br UI chrome strings (skip link, pagination, a11y labels, 404,
// consent, footer copy). Used when a tenant declares no `display`. siteName /
// description are intentionally empty — siteName is overlaid from the BOLT
// config at render; per-page description comes from the WP post/page.
export const DEFAULT_DISPLAY: LocaleDisplay = {
  siteName: '',
  siteShortName: '',
  tagline: '',
  description: '',
  // ↓↓↓ copy verticals/nav/legalConsent/ui/notFound/noscript/footer VERBATIM
  //     from sites.config.ts SITES.limitemais.display["pt-br"] ↓↓↓
  verticals: {
    cc: 'Cartão de Crédito',
    loans: 'Empréstimo',
    insurance: 'Seguros',
    education: 'Educação Financeira',
  },
  nav: { blog: 'Blog', home: 'Início' },
  legalConsent: '',
  ui: {
    skipLink: 'Pular para o conteúdo principal',
    sponsored: 'Patrocinado',
    by: 'Por',
    minRead: 'min de leitura',
    continueLabel: 'Continuar',
    relatedPosts: 'Artigos relacionados',
    breadcrumbAria: 'Trilha de navegação',
    primaryNavAria: 'Principal',
    progressAria: 'Progresso do quiz',
    languageNavAria: 'Idioma',
    noPostsYet: 'Ainda não há artigos — volte em breve.',
    back: 'Voltar',
    onThisPage: 'Nesta página',
    share: 'Compartilhar',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado',
    prevPage: 'Anterior',
    nextPage: 'Próximo',
    pageLabel: 'Página',
    paginationAria: 'Paginação',
    reviewedBy: 'Revisado por',
    keyTakeaways: 'Key takeaways',
    faqHeading: 'Perguntas frequentes',
    editorsPick: 'Escolha do editor',
    affiliateDisclosure:
      'Podemos receber comissão de parceiros. Isso não afeta nossas recomendações.',
    adLabel: 'Publicidade',
    menuToggle: 'Menu',
  },
  notFound: {
    heading: 'Página não encontrada',
    subheading: 'A página que você procura não existe ou foi movida.',
    cta: 'Voltar ao início',
  },
  noscript: {
    quiz: 'Este quiz requer JavaScript. Habilite-o no seu navegador para continuar.',
    capture:
      'Enviar o formulário requer JavaScript. Habilite-o no seu navegador para receber sua recomendação.',
  },
  footer: { links: [], contactLabel: 'Contato' },
};
