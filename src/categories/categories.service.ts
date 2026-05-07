import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    return this.databaseService.category.create({ data: createCategoryDto });
  }

  async findAll() {
    return this.databaseService.category.findMany();
  }

  async findCategoryById(id: string) {
    const category = await this.databaseService.category.findUnique({
      where: { id },
    });

    if (!category) throw new NotFoundException('Category not found');

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    return this.databaseService.category.update({
      where: { id },
      data: updateCategoryDto,
    });
  }

  async remove(id: string) {
    return this.databaseService.category.delete({ where: { id } });
  }
}
