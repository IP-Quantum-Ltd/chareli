import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Game } from './Games';

export interface CategoryFaqAnswers {
  whatAre?: string;
  mostPopular?: string;
  doINeedToDownload?: string;
  areTheyFree?: string;
}

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  name: string;

  @Column({ unique: true })
  @Index()
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  introText: string | null;

  @Column({ type: 'jsonb', nullable: true })
  faqAnswers: CategoryFaqAnswers | null;

  @Column({ default: false })
  isDefault: boolean;

  @OneToMany('Game', 'category')
  games: Game[];

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
