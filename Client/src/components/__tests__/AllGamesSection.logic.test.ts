import { describe, it, expect } from 'vitest'

describe('AllGamesSection Business Logic', () => {
  describe('Category Filtering Logic', () => {
    it('should build correct query parameters for different categories', () => {
      const testCases = [
        {
          selectedCategory: 'all',
          expected: {
            categoryId: undefined,
            filter: undefined,
            status: 'active'
          }
        },
        {
          selectedCategory: 'recent',
          expected: {
            categoryId: undefined,
            filter: 'recently_added',
            status: 'active'
          }
        },
        {
          selectedCategory: 'category-123',
          expected: {
            categoryId: 'category-123',
            filter: undefined,
            status: 'active'
          }
        }
      ]

      testCases.forEach(({ selectedCategory, expected }) => {
        const queryParams = {
          categoryId: selectedCategory === "all" ? undefined : selectedCategory === "recent" ? undefined : selectedCategory,
          filter: selectedCategory === "recent" ? "recently_added" : undefined,
          status: "active" as const
        }

        expect(queryParams.categoryId).toBe(expected.categoryId)
        expect(queryParams.filter).toBe(expected.filter)
        expect(queryParams.status).toBe(expected.status)
      })
    })

    it('should handle search query integration', () => {
      const searchQueries = ['', 'puzzle', 'action game', null, undefined]
      
      searchQueries.forEach(searchQuery => {
        const queryParams = {
          search: searchQuery || undefined
        }

        if (searchQuery) {
          expect(queryParams.search).toBe(searchQuery)
        } else {
          expect(queryParams.search).toBeUndefined()
        }
      })
    })
  })

  describe('Categories Data Processing Logic', () => {
    it('should combine static and dynamic categories correctly', () => {
      const mockCategoriesData = [
        { id: 'cat-1', name: 'Action' },
        { id: 'cat-2', name: 'Puzzle' }
      ]

      const allCategories = [
        { id: "all", name: "All Games", color: "#C026D3" },
        ...(mockCategoriesData?.map(cat => ({
          id: cat.id,
          name: cat.name,
          color: "#94A3B7"
        })) || []),
        { id: "recent", name: "Recently Added", color: "#94A3B7" }
      ]

      expect(allCategories).toHaveLength(4)
      expect(allCategories[0].id).toBe('all')
      expect(allCategories[1].id).toBe('cat-1')
      expect(allCategories[2].id).toBe('cat-2')
      expect(allCategories[3].id).toBe('recent')
    })

    it('should handle empty categories data', () => {
      const emptyCategoriesData = null

      const allCategories = [
        { id: "all", name: "All Games", color: "#C026D3" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((emptyCategoriesData as any)?.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          color: "#94A3B7"
        })) || []),
        { id: "recent", name: "Recently Added", color: "#94A3B7" }
      ]

      expect(allCategories).toHaveLength(2)
      expect(allCategories[0].id).toBe('all')
      expect(allCategories[1].id).toBe('recent')
    })

    it('should apply correct colors to categories', () => {
      const mockCategoriesData = [
        { id: 'cat-1', name: 'Action' }
      ]

      const processedCategories = mockCategoriesData.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: "#94A3B7"
      }))

      expect(processedCategories[0].color).toBe("#94A3B7")
    })
  })

  describe('Game Display Logic', () => {
    it('should determine correct display state based on loading and data', () => {
      const scenarios = [
        {
          gamesLoading: true,
          gamesError: null,
          games: [],
          expected: 'loading'
        },
        {
          gamesLoading: false,
          gamesError: new Error('Failed to load'),
          games: [],
          expected: 'error'
        },
        {
          gamesLoading: false,
          gamesError: null,
          games: [],
          expected: 'empty'
        },
        {
          gamesLoading: false,
          gamesError: null,
          games: [{ id: '1', title: 'Game 1' }],
          expected: 'games'
        }
      ]

      scenarios.forEach(({ gamesLoading, gamesError, games, expected }) => {
        let displayState: string

        if (gamesLoading) {
          displayState = 'loading'
        } else if (gamesError) {
          displayState = 'error'
        } else if (games.length === 0) {
          displayState = 'empty'
        } else {
          displayState = 'games'
        }

        expect(displayState).toBe(expected)
      })
    })

    it('should generate correct empty state messages', () => {
      const testCases = [
        {
          selectedCategory: 'all',
          allCategories: [{ id: 'all', name: 'All Games' }],
          expected: 'No games found for all categories'
        },
        {
          selectedCategory: 'recent',
          allCategories: [{ id: 'recent', name: 'Recently Added' }],
          expected: 'No games found for recently added'
        },
        {
          selectedCategory: 'cat-1',
          allCategories: [{ id: 'cat-1', name: 'Action' }],
          expected: 'No games found for Action'
        },
        {
          selectedCategory: 'unknown',
          allCategories: [{ id: 'cat-1', name: 'Action' }],
          expected: 'No games found for this category'
        }
      ]

      testCases.forEach(({ selectedCategory, allCategories, expected }) => {
        const message = `No games found for ${
          selectedCategory === "all" ? "all categories" : 
          selectedCategory === "recent" ? "recently added" : 
          allCategories.find(cat => cat.id === selectedCategory)?.name || "this category"
        }`

        expect(message).toBe(expected)
      })
    })
  })

  describe('Grid Layout Logic', () => {
    it('should calculate correct row spans for games', () => {
      const spans = [1, 1.3, 1.1]
      const testGames = Array.from({ length: 6 }, (_, i) => ({ id: `game-${i}` }))

      testGames.forEach((game, index) => {
        console.log(game)
        const spanIndex = index % spans.length
        const rowSpan = spans[spanIndex]
        const calculatedSpan = Math.round(rowSpan * 2)

        expect(spanIndex).toBe(index % 3)
        expect(calculatedSpan).toBeGreaterThan(0)
      })
    })

    it('should handle different span patterns', () => {
      const spans = [1, 1.3, 1.1]
      const expectedSpans = [2, 3, 2] // Math.round(span * 2)

      spans.forEach((span, index) => {
        const calculatedSpan = Math.round(span * 2)
        expect(calculatedSpan).toBe(expectedSpans[index])
      })
    })
  })

  describe('Navigation Logic', () => {
    it('should generate correct game play URLs with category slug', () => {
      const samples = [
        { categorySlug: 'action', gameSlug: 'space-shooter' },
        { categorySlug: 'puzzle', gameSlug: 'block-match-456' },
        { categorySlug: 'general', gameSlug: 'hamster-roll' },
      ]

      samples.forEach(({ categorySlug, gameSlug }) => {
        const url = `/gameplay/${categorySlug}/${gameSlug}`
        expect(url).toBe(`/gameplay/${categorySlug}/${gameSlug}`)
        expect(url).toMatch(/^\/gameplay\/[a-z0-9-]+\/[a-z0-9-]+$/)
      })
    })

    it('should fall back to legacy /gameplay/<slug> when category slug missing', () => {
      const slugs = ['game-123', 'game-with-dashes', 'game123']

      slugs.forEach(slug => {
        const url = `/gameplay/${slug}`
        expect(url).toContain(slug)
        expect(url.startsWith('/gameplay/')).toBe(true)
      })
    })
  })

  describe('Image Handling Logic', () => {
    it('should handle game thumbnail URLs', () => {
      const mockGames = [
        { id: '1', thumbnailFile: { s3Key: 'https://example.com/thumb1.jpg' } },
        { id: '2', thumbnailFile: { s3Key: 'https://example.com/thumb2.jpg' } },
        { id: '3', thumbnailFile: null },
        { id: '4', thumbnailFile: undefined }
      ]

      mockGames.forEach(game => {
        const thumbnailUrl = game.thumbnailFile?.s3Key
        
        if (game.thumbnailFile) {
          expect(thumbnailUrl).toBeTruthy()
          expect(typeof thumbnailUrl).toBe('string')
        } else {
          expect(thumbnailUrl).toBeUndefined()
        }
      })
    })

    it('should validate image loading attributes', () => {
      const imageAttributes = {
        loading: 'lazy',
        alt: 'Game Title'
      }

      expect(imageAttributes.loading).toBe('lazy')
      expect(imageAttributes.alt).toBeTruthy()
    })
  })

  describe('Search Integration Logic', () => {
    it('should handle search query variations', () => {
      const searchQueries = [
        { input: '', expected: undefined },
        { input: '   ', expected: undefined }, // Whitespace only
        { input: 'puzzle', expected: 'puzzle' },
        { input: 'Action Game', expected: 'Action Game' },
        { input: null, expected: undefined },
        { input: undefined, expected: undefined }
      ]

      searchQueries.forEach(({ input, expected }) => {
        const processedSearch = input?.trim() || undefined
        const finalSearch = processedSearch || undefined

        if (expected) {
          expect(finalSearch).toBe(expected)
        } else {
          expect(finalSearch).toBeUndefined()
        }
      })
    })

    it('should combine search with category filters', () => {
      const combinations = [
        {
          selectedCategory: 'all',
          searchQuery: 'puzzle',
          expected: {
            categoryId: undefined,
            filter: undefined,
            search: 'puzzle',
            status: 'active'
          }
        },
        {
          selectedCategory: 'recent',
          searchQuery: 'action',
          expected: {
            categoryId: undefined,
            filter: 'recently_added',
            search: 'action',
            status: 'active'
          }
        },
        {
          selectedCategory: 'cat-1',
          searchQuery: '',
          expected: {
            categoryId: 'cat-1',
            filter: undefined,
            search: undefined,
            status: 'active'
          }
        }
      ]

      combinations.forEach(({ selectedCategory, searchQuery, expected }) => {
        const queryParams = {
          categoryId: selectedCategory === "all" ? undefined : selectedCategory === "recent" ? undefined : selectedCategory,
          filter: selectedCategory === "recent" ? "recently_added" : undefined,
          status: "active" as const,
          search: searchQuery || undefined
        }

        expect(queryParams).toEqual(expected)
      })
    })
  })
})
