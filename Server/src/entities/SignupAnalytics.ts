import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';

@Entity('signup_analytics', { schema: 'internal' })
export class SignupAnalytics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  @Index()
  sessionId: string;

  @Column({ name: 'user_id', nullable: true })
  @Index()
  userId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ nullable: true })
  @Index()
  country: string;

  @Column({ nullable: true })
  @Index()
  deviceType: string; // 'mobile', 'tablet', 'desktop'

  @Column()
  @Index()
  type: string; // Type of signup form that was clicked

  @CreateDateColumn()
  @Index()
  createdAt: Date;
}
