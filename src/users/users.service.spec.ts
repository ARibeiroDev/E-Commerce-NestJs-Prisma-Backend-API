import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException } from '@nestjs/common';

// mock bcrypt to avoid hashing for real
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('UsersService', () => {
  let service: UsersService;

  // mock database
  const mockDatabaseService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    // reset all mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // basic test for successful service creation
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMe', () => {
    it('should return user if found', async () => {
      const user = { id: '1', username: 'john' };

      // explain mock what to return
      mockDatabaseService.user.findUnique.mockResolvedValue(user);

      const result = await service.getMe('1');

      // assertions
      expect(result).toEqual(user);
      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: '1' } }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDatabaseService.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('should update username only', async () => {
      mockDatabaseService.user.update.mockResolvedValue({
        id: '1',
        username: 'new',
      });
      const result = await service.updateMe('1', { username: 'new' });
      expect(result).toBeDefined();
      expect(mockDatabaseService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { username: 'new' } }),
      );
    });
    it('should hash password before saving', async () => {
      mockDatabaseService.user.update.mockResolvedValue({ id: '1' });
      await service.updateMe('1', { password: '123456' });
      expect(mockDatabaseService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            password: 'hashed-password', // 👈 from mocked bcrypt
          }),
        }),
      );
    });
  });
});
