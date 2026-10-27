import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TenancyModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
