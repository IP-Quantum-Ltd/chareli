export type CategoryFaqKey =
  | 'whatAre'
  | 'mostPopular'
  | 'doINeedToDownload'
  | 'areTheyFree';

export const CATEGORY_FAQ_QUESTIONS: ReadonlyArray<{
  key: CategoryFaqKey;
  template: (name: string) => string;
}> = [
  { key: 'whatAre', template: (n) => `What are ${n} games?` },
  {
    key: 'mostPopular',
    template: (n) => `Which ${n} games are most popular right now?`,
  },
  {
    key: 'doINeedToDownload',
    template: (n) => `Do I need to download ${n} games?`,
  },
  { key: 'areTheyFree', template: (n) => `Are ${n} games free to play?` },
];
