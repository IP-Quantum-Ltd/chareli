import * as yup from 'yup';

const FAQ_ANSWER_MAX = 200;
const INTRO_TEXT_WORD_MAX = 200;

const wordCount = (text: string) =>
  text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;

const introTextSchema = yup
  .string()
  .trim()
  .nullable()
  .test(
    'word-count',
    `Intro text must be ${INTRO_TEXT_WORD_MAX} words or fewer`,
    (value) => !value || wordCount(value) <= INTRO_TEXT_WORD_MAX
  );

const answerField = yup
  .string()
  .trim()
  .max(FAQ_ANSWER_MAX, `Answer must be ${FAQ_ANSWER_MAX} characters or fewer`)
  .nullable();

const faqAnswersSchema = yup
  .object({
    whatAre: answerField,
    mostPopular: answerField,
    doINeedToDownload: answerField,
    areTheyFree: answerField,
  })
  .nullable()
  .noUnknown();

export const createCategorySchema = yup.object({
  name: yup.string().trim().required('Category name is required'),
  description: yup.string().trim().nullable(),
  introText: introTextSchema,
  faqAnswers: faqAnswersSchema,
});

export const updateCategorySchema = yup
  .object({
    name: yup.string().trim(),
    description: yup.string().trim().nullable(),
    introText: introTextSchema,
    faqAnswers: faqAnswersSchema,
  })
  .test(
    'at-least-one-field',
    'At least one field must be provided',
    (value) => Object.keys(value).length > 0
  );

export const categoryIdParamSchema = yup.object({
  id: yup
    .string()
    .uuid('Invalid category ID')
    .required('Category ID is required'),
});

export const categorySlugParamSchema = yup.object({
  slug: yup
    .string()
    .trim()
    .matches(/^[a-z0-9-]+$/, 'Invalid category slug')
    .required('Category slug is required'),
});

export const categoryQuerySchema = yup.object({
  page: yup.number().integer().min(1),
  limit: yup.number().integer().min(1).max(100),
  search: yup.string(),
  sortBy: yup.string(),
});
