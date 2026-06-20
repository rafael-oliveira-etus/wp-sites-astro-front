import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema, quizSchema } from './lib/schemas';

// SSR enablement: content.config is evaluated during the workerd prerender of quiz
// routes, so it must not import the node-only loaders (tenant.build.ts). The
// absolute content dir is baked by astro.config.ts via vite.define.
const base = import.meta.env.TENANT_CONTENT_DIR as string;

const quiz = defineCollection({
  loader: glob({ pattern: '*/quiz/*/*.yaml', base }),
  schema: quizSchema,
});

const post = defineCollection({
  loader: glob({ pattern: '*/blog/*/*.yaml', base }),
  schema: postSchema,
});

export const collections = { quiz, post };
