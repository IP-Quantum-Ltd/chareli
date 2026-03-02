import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Category } from './Category';
import { User } from './User';
import { File } from './Files';

export enum GameStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export enum GameProcessingStatus {
  PENDING = 'pending', // ZIP processing queued
  PROCESSING = 'processing', // ZIP being extracted/uploaded
  COMPLETED = 'completed', // Ready to play
  FAILED = 'failed', // Processing failed
}

@Entity('games')
@Index(['status', 'position'])
@Index(['categoryId', 'status'])
@Index(['status', 'createdAt'])
@Index(['createdById', 'status'])
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ unique: true })
  @Index()
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  thumbnailFileId: string;

  @ManyToOne(() => File, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'thumbnailFileId' })
  thumbnailFile: File;

  @Column({
    type: 'enum',
    enum: GameStatus,
    default: GameStatus.ACTIVE,
  })
  @Index()
  status: GameStatus;

  @Column({ nullable: true })
  gameFileId: string;

  @ManyToOne(() => File, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'gameFileId' })
  gameFile: File;

  @Column({ type: 'int', default: 0 })
  config: number;

  @Column({ type: 'int', default: 100 })
  baseLikeCount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastLikeIncrement: Date;

  @ManyToOne(() => Category, (category) => category.games, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @Column({ nullable: true })
  @Index()
  categoryId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ nullable: true })
  @Index()
  createdById: string;

  @Column({ type: 'int', nullable: true })
  @Index()
  position: number;

  @Column({
    type: 'enum',
    enum: GameProcessingStatus,
    default: GameProcessingStatus.COMPLETED,
  })
  @Index()
  processingStatus: GameProcessingStatus;

  @Column({ type: 'text', nullable: true })
  processingError: string;

  @Column({ type: 'varchar', nullable: true })
  jobId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    howToPlay?: string;
    features?: string[];
    tags?: string[];
    seoKeywords?: string;
    developer?: string;
    platform?: string[];
    releaseDate?: string;
    faqOverride?: string;
    schemaVersion?: string;
  } | null;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
