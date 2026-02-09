import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Use a pool of 10 connections so concurrent API requests don't time out. */
function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
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
    const url = datasourceUrl();
    super(url ? { datasources: { db: { url } } } : {});
  }

  async onModuleInit() {
    await this.$connect();
  }
}
