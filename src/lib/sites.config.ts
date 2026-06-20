import { type Tenant } from './schemas';

// Single source of truth for every deployed site. Add a site = add an entry.
// Keyed by tenant id. Resolved at request time by middleware via the Host header.
export const SITES: Record<string, Tenant> = {
  "limitemais": {
    "id": "limitemais",
    "domains": [
      "limitemais.com",
      "www.limitemais.com"
    ],
    "defaultLocale": "pt-br",
    "locales": [
      "pt-br"
    ],
    "theme": "classic",
    "brand": {
      "primaryColor": "#0c7a3f",
      "secondaryColor": "#0f172a",
      "bgColor": "#f1f4f7",
      "textColor": "#1f2937",
      "mutedTextColor": "#555851",
      "logo": {
        "src": "https://media.limitemais.com/uploads/2021/11/limite_mais_logo.png.webp",
        "width": 256,
        "height": 50
      }
    },
    "seo": {
      "twitterHandle": "@limitemais",
      "organization": {
        "name": "Limite Mais",
        "legalName": "ETUS Media Holding Ltda",
        "url": "https://limitemais.com",
        "sameAs": []
      }
    },
    "display": {
      "pt-br": {
        "siteName": "Limite Mais",
        "siteShortName": "Limite Mais",
        "tagline": "Conteúdo sobre cartões, empréstimos e finanças pessoais",
        "description": "Notícias e guias sobre cartão de crédito, empréstimo, conta digital e finanças pessoais.",
        "verticals": {
          "cc": "Cartão de Crédito",
          "loans": "Empréstimo",
          "insurance": "Seguros",
          "education": "Educação Financeira"
        },
        "nav": {
          "blog": "Blog",
          "home": "Início"
        },
        "legalConsent": "Ao finalizar este quiz, declaro ter lido e aceitado os termos de serviço e aceito receber comunicações da Limite Mais, que podem ser canceladas a qualquer momento.",
        "ui": {
          "skipLink": "Pular para o conteúdo principal",
          "sponsored": "Patrocinado",
          "by": "Por",
          "minRead": "min de leitura",
          "continueLabel": "Continuar",
          "relatedPosts": "Artigos relacionados",
          "breadcrumbAria": "Trilha de navegação",
          "primaryNavAria": "Principal",
          "progressAria": "Progresso do quiz",
          "languageNavAria": "Idioma",
          "noPostsYet": "Ainda não há artigos — volte em breve.",
          "back": "Voltar",
          "onThisPage": "Nesta página",
          "share": "Compartilhar",
          "copyLink": "Copiar link",
          "linkCopied": "Link copiado",
          "prevPage": "Anterior",
          "nextPage": "Próximo",
          "pageLabel": "Página",
          "paginationAria": "Paginação",
          "reviewedBy": "Revisado por",
          "keyTakeaways": "Key takeaways",
          "faqHeading": "Frequently asked questions",
          "editorsPick": "Editor's pick",
          "affiliateDisclosure": "We may earn a commission from our partners. It does not affect our recommendations.",
          "adLabel": "Publicidade",
          "menuToggle": "Menu"
        },
        "notFound": {
          "heading": "Página não encontrada",
          "subheading": "A página que você procura não existe ou foi movida.",
          "cta": "Voltar ao início"
        },
        "noscript": {
          "quiz": "Este quiz requer JavaScript. Habilite-o no seu navegador para continuar.",
          "capture": "Enviar o formulário requer JavaScript. Habilite-o no seu navegador para receber sua recomendação."
        },
        "footer": {
          "links": [
            {
              "label": "Termos de uso",
              "href": "/termos"
            },
            {
              "label": "Política de privacidade",
              "href": "/privacidade"
            }
          ],
          "contactLabel": "Contato",
          "disclosure": "A Limite Mais oferece conteúdo gratuito sobre cartões de crédito, bancos digitais, empréstimos e serviços financeiros de terceiros. Não somos uma instituição financeira, nem sempre temos afiliação com os emissores destacados e nunca cobramos pelo acesso. Nossas recomendações são apenas informativas e não constituem aconselhamento financeiro; consulte profissionais licenciados.\nCumprimos a LGPD, GDPR e CCPA. Você pode acessar, corrigir ou excluir seus dados a qualquer momento. Operado por ETUS Media Holding Ltda (CNPJ: 00.000.000/0001-00), Av. Paulista 1000, São Paulo, SP, Brasil. Contato: privacidade@limitemais.com\n"
        }
      }
    },
    "editorial": {
      "name": "Equipe Limite Mais",
      "bio": "Equipe editorial especializada em cartões de crédito, empréstimos e finanças pessoais no Brasil."
    },
    "authors": {
      "renato-mesquita": {
        "name": "Renato Mesquita",
        "title": "",
        "bio": "",
        "sameAs": []
      }
    },
    "authorByVertical": {
      "cc": "renato-mesquita",
      "loans": "renato-mesquita",
      "insurance": "renato-mesquita",
      "education": "renato-mesquita"
    },
    "tracking": {
      "eventsApiUrl": "",
      "writeKey": "",
      "turnstile": {
        "enabled": false,
        "siteKey": ""
      },
      "meta": {
        "pixels": []
      },
      "tiktok": {
        "pixels": []
      },
      "googleAds": {
        "accounts": []
      },
      "ga4": {
        "properties": []
      },
      "microsoftUet": {
        "tags": []
      }
    },
    "crm": {
      "endpoint": ""
    },
    "webpush": {
      "enabled": false,
      "delaySeconds": 8,
      "requestPermissionOnAccept": false
    },
    "legal": {
      "company": {
        "name": "ETUS Media Holding Ltda",
        "taxIdLabel": "CNPJ",
        "taxId": "00.000.000/0001-00",
        "address": "Av. Paulista 1000, Sala 100, São Paulo, SP, Brasil",
        "contactEmail": "contato@limitemais.com",
        "contactPhone": "+55 11 0000-0000"
      }
    },
    "blog": {
      "wpBaseUrl": "https://limitemais.com",
      "menus": {
        "header": "header-menu",
        "footer": "footer-first-menu"
      }
    }
  }
};

// host (lowercased, port + trailing dot stripped) -> tenant, by suffix match.
// 'host === domain' or 'host endsWith .domain' (covers www + subdomains; never
// a substring 'contains', which would let look-alike domains spoof a tenant).
export function matchHost(
  host: string | null | undefined,
  sites: Record<string, Tenant>,
): Tenant | null {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0].replace(/\.$/, '');
  for (const site of Object.values(sites)) {
    for (const d of site.domains) {
      const dom = d.toLowerCase();
      if (h === dom || h.endsWith('.' + dom)) return site;
    }
  }
  return null;
}

export function resolveTenantByHost(host: string | null | undefined): Tenant | null {
  return matchHost(host, SITES);
}

/** Dev/preview fallback: pick a tenant by id (TENANT_ID) or the first site. */
export function fallbackTenant(id?: string): Tenant {
  if (id && SITES[id]) return SITES[id];
  const first = Object.values(SITES)[0];
  if (!first) throw new Error('SITES is empty');
  return first;
}
