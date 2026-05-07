import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import slugify from '@sindresorhus/slugify';
import crypto from 'crypto';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Size & Color Palettes
const letterSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const colors = [
  'Black',
  'White',
  'Blue',
  'Red',
  'Green',
  'Yellow',
  'Gray',
  'Pink',
  'Purple',
  'Beige',
  'Brown',
  'Orange',
];
const shoeSizes = Array.from({ length: 9 }, (_, i) => 38 + i);
const waistSizes = Array.from({ length: 9 }, (_, i) => 28 + i);
const lengthSizes = Array.from({ length: 5 }, (_, i) => 30 + i);

// Functions
const generateSku = (
  category: string,
  color: string,
  size: string | number,
) => {
  const clean = (str: string) =>
    str
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 4)
      .toUpperCase();
  const shortHash = crypto.randomBytes(3).toString('hex').toUpperCase();

  return `${clean(category)}-${clean(color)}-${typeof size === 'string' ? clean(size) : size}-${shortHash}`;
};

const calculateFinalPrice = (
  basePrice: number,
  discountPercentage?: number,
) => {
  if (!discountPercentage) return basePrice;
  return basePrice - (basePrice * discountPercentage) / 100;
};

function getRandomVariants(
  sizes: (string | number)[],
  colors: string[],
  maxVariants?: number,
) {
  const variants: { size: string | number; color: string }[] = [];

  const shuffle = <T>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

  const shuffledSizes = shuffle(sizes);
  const shuffledColors = shuffle(colors);

  const variantCount = maxVariants
    ? Math.min(maxVariants, sizes.length * colors.length)
    : sizes.length * colors.length;

  while (variants.length < variantCount) {
    const size =
      shuffledSizes[Math.floor(Math.random() * shuffledSizes.length)];
    const color =
      shuffledColors[Math.floor(Math.random() * shuffledColors.length)];

    if (!variants.find((v) => v.size === size && v.color === color)) {
      variants.push({ size, color });
    }
  }

  return variants;
}

// Main seeding function
const main = async () => {
  console.log('Starting seed...');

  const categoryNames = [
    'T-shirts',
    'Jeans',
    'Jackets',
    'Shoes',
    'Accessories',
  ];

  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const categories = await prisma.category.findMany();
  const categoryMap = categories.reduce(
    (acc, c) => ({ ...acc, [c.name]: c.id }),
    {} as Record<string, string>,
  );

  const products = [
    {
      title: 'Classic T-Shirt',
      images: [
        'https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=687&auto=format&fit=crop',
      ],
      description:
        'A timeless classic t-shirt made from 100% organic cotton. Soft, breathable, and perfect for everyday wear.',
      basePrice: 19.99,
      stock: 120,
      featured: true,
      discountPercentage: 10,
      category: 'T-shirts',
    },
    {
      title: 'Graphic Tee - Urban Vibes',
      images: [
        'https://images.unsplash.com/photo-1618354691438-25bc04584c23?auto=format&fit=crop&q=80&w=715',
      ],
      description:
        'Soft cotton tee featuring a bold urban graphic print. Perfect for casual streetwear.',
      basePrice: 24.99,
      stock: 75,
      featured: false,
      category: 'T-shirts',
    },
    {
      title: 'Striped Polo Shirt',
      images: [
        'https://images.unsplash.com/photo-1760287363713-a864ca9b1b1f?auto=format&fit=crop&q=60&w=600',
      ],
      description:
        'Classic striped polo shirt with a slim fit, made with breathable cotton blend.',
      basePrice: 29.99,
      stock: 50,
      featured: true,
      category: 'T-shirts',
    },
    {
      title: 'Leather Biker Jacket',
      images: [
        'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=735',
      ],
      description:
        'Premium genuine leather biker jacket with asymmetrical zipper and quilted detailing.',
      basePrice: 199.99,
      stock: 20,
      featured: true,
      discountPercentage: 15,
      category: 'Jackets',
    },
    {
      title: 'Denim Trucker Jacket',
      images: [
        'https://images.unsplash.com/photo-1611312449408-fcece27cdbb7?auto=format&fit=crop&q=80&w=669',
      ],
      description:
        'Classic denim trucker jacket with button closure and chest pockets.',
      basePrice: 89.99,
      stock: 45,
      featured: false,
      category: 'Jackets',
    },
    {
      title: 'Puffer Jacket - Winter Warmth',
      images: [
        'https://images.unsplash.com/photo-1706765779494-2705542ebe74?auto=format&fit=crop&q=80&w=1051',
      ],
      description:
        'Lightweight but warm puffer jacket with water-resistant fabric and hood.',
      basePrice: 129.99,
      stock: 35,
      featured: true,
      category: 'Jackets',
    },
    {
      title: 'Slim Fit Jeans',
      images: [
        'https://images.unsplash.com/photo-1669817021153-5f4d91ab182e?auto=format&fit=crop&q=80&w=687',
      ],
      description:
        'Classic slim fit jeans with a slightly faded wash, comfortable stretch fabric.',
      basePrice: 49.99,
      stock: 90,
      featured: false,
      category: 'Jeans',
    },
    {
      title: 'Denim Jeans',
      images: [
        'https://images.unsplash.com/photo-1516271099866-de31ba93ee4b?auto=format&fit=crop&w=880',
      ],
      description: 'Stylish denim jeans with a mid-rise waist and tapered leg.',
      basePrice: 54.99,
      stock: 60,
      featured: true,
      discountPercentage: 5,
      category: 'Jeans',
    },
    {
      title: 'Relaxed Fit Jeans',
      images: [
        'https://images.unsplash.com/photo-1736078151842-51af2f1e3ae1?auto=format&fit=crop&q=80&w=687',
      ],
      description:
        'Comfortable relaxed fit jeans with classic five-pocket styling and durable denim fabric.',
      basePrice: 44.99,
      stock: 40,
      featured: false,
      category: 'Jeans',
    },
    {
      title: 'Sneakers',
      images: [
        'https://images.unsplash.com/photo-1544441892-794166f1e3be?auto=format&fit=crop&q=80&w=1170',
      ],
      description:
        'Classic low-top sneakers made with breathable materials and cushioned sole.',
      basePrice: 69.99,
      stock: 100,
      featured: true,
      category: 'Shoes',
    },
    {
      title: 'Running Shoes',
      images: [
        'https://images.unsplash.com/photo-1637437757614-6491c8e915b5?auto=format&fit=crop&q=80&w=1170',
      ],
      description:
        'Lightweight running shoes with cushioned soles and breathable mesh upper.',
      basePrice: 79.99,
      stock: 80,
      featured: false,
      discountPercentage: 12,
      category: 'Shoes',
    },
    {
      title: 'Leather Boots',
      images: [
        'https://images.unsplash.com/photo-1616610868156-fe7e276de965?auto=format&fit=crop&q=80&w=880',
      ],
      description:
        'Durable leather boots with lace-up design, perfect for outdoor wear.',
      basePrice: 119.99,
      stock: 30,
      featured: true,
      category: 'Shoes',
    },
    {
      title: 'Vintage Band T-Shirt',
      images: [
        'https://images.unsplash.com/photo-1629253023149-b520b2a6f342?auto=format&fit=crop&q=80&w=764',
      ],
      description:
        'Retro style band t-shirt with distressed print, made from soft cotton.',
      basePrice: 22.99,
      stock: 85,
      featured: false,
      category: 'T-shirts',
    },
    {
      title: 'Long Sleeve Henley Shirt',
      images: [
        'https://images.unsplash.com/photo-1655141559787-25ac8cfca72f?auto=format&fit=crop&q=80&w=627',
      ],
      description:
        'Comfortable henley shirt with three-button placket, perfect for layering.',
      basePrice: 27.5,
      stock: 70,
      featured: true,
      discountPercentage: 8,
      category: 'T-shirts',
    },
    {
      title: 'Cotton V-Neck T-Shirt',
      images: [
        'https://images.unsplash.com/photo-1620799139652-715e4d5b232d?auto=format&fit=crop&q=80&w=1072',
      ],
      description:
        'Soft V-neck tee made from breathable cotton for everyday comfort.',
      basePrice: 18.75,
      stock: 100,
      featured: false,
      category: 'T-shirts',
    },
    {
      title: 'Wool Blend Overcoat',
      images: [
        'https://images.unsplash.com/photo-1746972466957-6fe022ade280?auto=format&fit=crop&q=80&w=687',
      ],
      description:
        'Elegant wool blend overcoat with notch lapels, perfect for formal occasions.',
      basePrice: 249.99,
      stock: 15,
      featured: true,
      discountPercentage: 10,
      category: 'Jackets',
    },
    {
      title: 'Fleece Hoodie',
      images: [
        'https://images.unsplash.com/photo-1588932250351-36235af5c0f0?auto=format&fit=crop&q=80&w=1170',
      ],
      description:
        'Warm fleece hoodie with kangaroo pocket and adjustable drawstrings.',
      basePrice: 49.99,
      stock: 60,
      featured: false,
      category: 'Jackets',
    },
    {
      title: 'Trench Coat',
      images: [
        'https://images.unsplash.com/photo-1633821879282-0c4e91f96232?auto=format&fit=crop&q=80&w=880',
      ],
      description: 'Classic beige trench coat with belt and waterproof finish.',
      basePrice: 179.99,
      stock: 25,
      featured: true,
      category: 'Jackets',
    },
    {
      title: 'Dark Wash Skinny Jeans',
      images: [
        'https://images.unsplash.com/photo-1715758890151-2c15d5d482aa?auto=format&fit=crop&q=80&w=687',
      ],
      description:
        'Trendy skinny fit jeans in dark wash denim with slight stretch for comfort.',
      basePrice: 54.99,
      stock: 70,
      featured: false,
      category: 'Jeans',
    },
    {
      title: 'Light Relaxed Jeans',
      images: [
        'https://images.unsplash.com/photo-1596152206972-524d46e0b22b?auto=format&fit=crop&q=80&w=686',
      ],
      description: 'Relaxed fit jeans in light denim, perfect for casual days.',
      basePrice: 44.99,
      stock: 50,
      featured: false,
      category: 'Jeans',
    },
    {
      title: 'Ripped Denim Shorts',
      images: [
        'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&q=80&w=1170',
      ],
      description:
        'Stylish ripped denim shorts with frayed hems, great for summer.',
      basePrice: 34.99,
      stock: 40,
      featured: true,
      discountPercentage: 7,
      category: 'Jeans',
    },
    {
      title: 'Running Sneakers',
      images: [
        'https://images.unsplash.com/photo-1584737969339-21edebd193ae?auto=format&fit=crop&q=60&w=600',
      ],
      description:
        'High-performance running sneakers with extra cushioning and breathable mesh.',
      basePrice: 84.99,
      stock: 65,
      featured: true,
      category: 'Shoes',
    },
    {
      title: 'Slip-On Canvas Shoes',
      images: [
        'https://images.unsplash.com/photo-1649920566440-eb5678255340?auto=format&fit=crop&q=80&w=1170',
      ],
      description:
        'Casual slip-on canvas shoes in beige, lightweight and comfortable for daily wear.',
      basePrice: 39.99,
      stock: 90,
      featured: false,
      category: 'Shoes',
    },
    {
      title: 'Chelsea Boots',
      images: [
        'https://images.unsplash.com/photo-1608629601270-a0007becead3?auto=format&fit=crop&q=80&w=1170',
      ],
      description: 'Elegant Chelsea boots with elastic side panels.',
      basePrice: 129.99,
      stock: 30,
      featured: true,
      discountPercentage: 10,
      category: 'Shoes',
    },
  ];

  for (const p of products) {
    const slug = slugify(p.title);

    let productSizes: (string | number)[] = letterSizes;
    const productColors: string[] = colors;

    if (p.category.toLowerCase() === 'shoes') {
      productSizes = shoeSizes;
    } else if (p.category.toLowerCase() === 'jeans') {
      productSizes = waistSizes.flatMap((w) =>
        lengthSizes.map((l) => `${w}x${l}`),
      );
    }

    const variants = getRandomVariants(
      productSizes,
      productColors,
      Math.floor(Math.random() * 6) + 1,
    );

    await prisma.product.upsert({
      where: { slug },
      update: {},
      create: {
        title: p.title,
        slug,
        description: p.description,
        images: p.images,
        categoryId: categoryMap[p.category],
        basePrice: new Prisma.Decimal(p.basePrice),
        featured: p.featured,
        tags: [p.category.toLowerCase(), 'clothing'],

        variants: {
          create: variants.map((v) => {
            const finalPrice = calculateFinalPrice(
              p.basePrice,
              p.discountPercentage,
            );

            return {
              color: v.color,
              size: String(v.size),
              stock: Math.floor(p.stock / variants.length),
              reservedStock: 0,
              discountPercentage: p.discountPercentage,
              finalPrice: new Prisma.Decimal(finalPrice),
              sku: generateSku(p.category, v.color, v.size),
            };
          }),
        },
      },
    });
  }

  console.log('Seed complete.');
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
