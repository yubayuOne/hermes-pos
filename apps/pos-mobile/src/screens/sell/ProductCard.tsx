import { memo, useState } from 'react';
import { Tap } from '../../components/Tap';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Display, Mono, Text } from '../../components/Text';
import { Hatch, Tag } from '../../components/bits';
import { Product } from '../../types/domain';
import { isSoldOut, isTracked } from '../../utils/stock';
import { colors } from '../../theme';
import { money, num, t } from '../../i18n';

/** Up to two letters for a product without a photo: "Kopi susu" -> KS, "Latte" -> L. */
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

function StockTag({ product }: { product: Product }) {
  if (!isTracked(product)) return null;
  if (isSoldOut(product)) return <Tag label={t('habis')} />;
  return <Tag label={t('stok {n}', { n: product.stock })} tone={product.stock <= 5 ? 'fire' : 'neutral'} />;
}

/**
 * Catalog card (DESIGN I4). Ringkas: text only, min 112px. Foto: the owner's photo in a uniform frame
 * (7px paper margin, its own 1.5px ink line, cropped cover, colors untouched). No photo, or a photo that fails
 * to load: initials on a tint block so the grid stays even. Sold out: hatched and disabled.
 * The quantity already on the bill sits in a 32px orange box at the top right.
 */
function ProductCardBase({
  product,
  qty,
  photo,
  photoHeight,
  landscape,
  locked,
  onAdd,
  lang,
}: {
  product: Product;
  qty: number;
  photo: boolean;
  photoHeight: number;
  landscape: boolean;
  locked: boolean;
  onAdd: (p: Product) => void;
  lang: string;
}) {
  void lang;
  const soldOut = isSoldOut(product);
  const disabled = soldOut || locked;
  const [failed, setFailed] = useState(false);
  const showImage = photo && !!product.imageUrl && !failed;

  return (
    <Tap
      disabled={disabled}
      onPress={() => onAdd(product)}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${product.name}, ${money(product.price)}${soldOut ? `, ${t('habis')}` : ''}${qty ? `, ${t('{n} di bill', { n: qty })}` : ''}`}
      className="overflow-hidden rounded-k"
      style={({ pressed }) => ({
        // Room for a two-line name, so long names do not make one card taller than the rest.
        minHeight: photo ? undefined : landscape ? 100 : 112,
        borderWidth: qty ? 2.5 : 1.5,
        borderColor: soldOut ? colors.disabledLine : colors.ink,
        backgroundColor: pressed && !disabled ? colors.tint : colors.slip,
        opacity: locked && !soldOut ? 0.55 : 1,
        transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
      })}
    >
      {soldOut ? <Hatch /> : null}
      {photo ? (
        <View
          style={{
            margin: landscape ? 5 : 7,
            marginBottom: 0,
            height: photoHeight,
            borderWidth: 1.5,
            borderColor: colors.ink,
            backgroundColor: colors.tint,
            overflow: 'hidden',
          }}
        >
          <View className="absolute inset-0 items-center justify-center">
            <Display size={landscape ? 22 : 30} style={{ color: colors.mute }}>
              {initials(product.name)}
            </Display>
          </View>
          {showImage ? (
            <Image
              source={{ uri: product.imageUrl! }}
              recyclingKey={product.id}
              cachePolicy="disk"
              contentFit="cover"
              transition={120}
              onError={() => setFailed(true)}
              accessibilityIgnoresInvertColors
              style={[{ width: '100%', height: '100%' }, soldOut ? ({ opacity: 0.5, filter: [{ grayscale: 1 }] } as any) : null]}
            />
          ) : null}
        </View>
      ) : null}
      {/* Foto: sized by its text. flex-1 there (no card height to fill) let the name and price collapse under a loaded photo. */}
      <View className={photo ? 'px-2.5 pb-2.5 pt-2' : `flex-1 justify-between ${landscape ? 'p-2.5' : 'p-3'}`}>
        <Text numberOfLines={photo && landscape ? 1 : 2} className="font-body-600 text-body" style={{ color: soldOut ? colors.mute : colors.ink }}>
          {product.name}
        </Text>
        <View className={`flex-row items-center justify-between gap-1 ${photo || landscape ? 'mt-1' : 'mt-3'}`}>
          <Mono className="text-body" style={{ color: soldOut ? colors.mute : colors.ink }}>
            {num(product.price)}
          </Mono>
          <StockTag product={product} />
        </View>
      </View>
      {qty > 0 ? (
        <View className="absolute right-0 top-0 h-[32px] min-w-[32px] items-center justify-center border-b-k border-l-k border-ink bg-fire px-1">
          <Mono className="font-mono-600 text-body">{qty}</Mono>
        </View>
      ) : null}
    </Tap>
  );
}
export const ProductCard = memo(ProductCardBase);

/** Temporary item card at the end of the grid: dashed, transparent. */
export function TempItemCard({ onPress, disabled, minHeight }: { onPress: () => void; disabled?: boolean; minHeight: number }) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={t('Menu sementara')}
      disabled={disabled}
      onPress={onPress}
      className="justify-center rounded-k p-3"
      style={({ pressed }) => ({
        minHeight,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.ink,
        backgroundColor: pressed ? colors.tint : 'transparent',
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <Text className="font-body-700 text-body">+ {t('Menu sementara')}</Text>
      <Text className="mt-1 text-small text-mute">{t('Sekali pakai, tidak masuk daftar produk')}</Text>
    </Tap>
  );
}

/** Static hatched placeholders while the menu loads (no shimmer, DESIGN I9a). */
export function SkeletonTile({ height }: { height: number }) {
  return (
    <View className="overflow-hidden rounded-k" style={{ height, borderWidth: 1.5, borderColor: colors.tint2, backgroundColor: colors.slip }}>
      <Hatch />
    </View>
  );
}
