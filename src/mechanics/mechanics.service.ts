import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class MechanicsService {
  constructor(private prisma: PrismaService) {}

  /** List bank accounts for a mechanic (mechanic-only). */
  async listBankAccounts(mechanicId: string) {
    return this.prisma.mechanicBankAccount.findMany({
      where: { mechanicId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Add a bank account. If isDefault or first account, set as default. */
  async addBankAccount(
    mechanicId: string,
    data: { bankCode: string; bankName: string; accountNumber: string; accountName: string; isDefault?: boolean },
  ) {
    const existing = await this.prisma.mechanicBankAccount.count({ where: { mechanicId } });
    const isDefault = data.isDefault ?? existing === 0;

    if (isDefault) {
      await this.prisma.mechanicBankAccount.updateMany({
        where: { mechanicId },
        data: { isDefault: false },
      });
    }

    return this.prisma.mechanicBankAccount.create({
      data: {
        mechanicId,
        bankCode: data.bankCode,
        bankName: data.bankName,
        accountNumber: data.accountNumber.trim(),
        accountName: data.accountName.trim(),
        isDefault,
      },
    });
  }

  /** Update a bank account (mechanic must own it). */
  async updateBankAccount(
    mechanicId: string,
    accountId: string,
    data: { bankCode?: string; bankName?: string; accountNumber?: string; accountName?: string; isDefault?: boolean },
  ) {
    const account = await this.prisma.mechanicBankAccount.findFirst({
      where: { id: accountId, mechanicId },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    if (data.isDefault && !account.isDefault) {
      await this.prisma.mechanicBankAccount.updateMany({
        where: { mechanicId },
        data: { isDefault: false },
      });
    }

    const updateData: Record<string, unknown> = {};
    if (data.bankCode !== undefined) updateData.bankCode = data.bankCode;
    if (data.bankName !== undefined) updateData.bankName = data.bankName;
    if (data.accountNumber !== undefined) updateData.accountNumber = data.accountNumber.trim();
    if (data.accountName !== undefined) updateData.accountName = data.accountName.trim();
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    return this.prisma.mechanicBankAccount.update({
      where: { id: accountId },
      data: updateData,
    });
  }

  /** Set default bank account. */
  async setDefaultBankAccount(mechanicId: string, accountId: string) {
    const account = await this.prisma.mechanicBankAccount.findFirst({
      where: { id: accountId, mechanicId },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    await this.prisma.mechanicBankAccount.updateMany({
      where: { mechanicId },
      data: { isDefault: false },
    });
    return this.prisma.mechanicBankAccount.update({
      where: { id: accountId },
      data: { isDefault: true },
    });
  }

  /** Delete a bank account (mechanic must own it). */
  async deleteBankAccount(mechanicId: string, accountId: string) {
    const account = await this.prisma.mechanicBankAccount.findFirst({
      where: { id: accountId, mechanicId },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    await this.prisma.mechanicBankAccount.delete({ where: { id: accountId } });
    if (account.isDefault) {
      const next = await this.prisma.mechanicBankAccount.findFirst({ where: { mechanicId } });
      if (next) {
        await this.prisma.mechanicBankAccount.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return { deleted: true };
  }

  /** Get default bank account for a mechanic (for admin payouts). */
  async getDefaultBankAccount(mechanicId: string) {
    return this.prisma.mechanicBankAccount.findFirst({
      where: { mechanicId, isDefault: true },
    });
  }

  async findById(id: string) {
    const mechanic = await this.prisma.mechanic.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (!mechanic) {
      throw new NotFoundException('Mechanic not found');
    }

    return mechanic;
  }

  async findByEmail(email: string) {
    return this.prisma.mechanic.findUnique({
      where: { email },
      include: { profile: true },
    });
  }

  async updateProfile(mechanicId: string, data: any) {
    const {
      profileComplete,
      ...profileData
    } = data;
    const profile = await this.prisma.mechanicProfile.upsert({
      where: { mechanicId },
      update: profileData,
      create: {
        mechanicId,
        ...profileData,
      },
    });

    await this.prisma.mechanic.update({
      where: { id: mechanicId },
      data: { profileComplete: true },
    });

    return profile;
  }

  async updateAvailability(mechanicId: string, availability: boolean) {
    return this.prisma.mechanicProfile.upsert({
      where: { mechanicId },
      update: { availability },
      create: {
        mechanicId,
        availability,
        expertise: [],
      },
    });
  }

  async findAll() {
    return this.prisma.mechanic.findMany({
      include: { profile: true },
    });
  }
}
