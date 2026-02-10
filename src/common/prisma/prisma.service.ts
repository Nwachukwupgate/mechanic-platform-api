import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** Build connection URL with pool size 10 so concurrent API requests don't time out. */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const limit = 'connection_limit=10';
  if (url.includes('connection_limit=')) {
    return url.replace(/connection_limit=\d+/, limit);
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${limit}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const adapter = new PrismaPg({ connectionString: connectionString() });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
