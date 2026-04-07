/**
 * Capture Card Component
 * ========================
 * Renders a single capture item in the feed/history.
 * Shows type icon, content preview, IMAGE THUMBNAILS, timestamp, lane, tags.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, fonts, radius } from '../theme/veritas';

const TYPE_ICONS = {
  clipboard: '📋',
  photo: '📷',
  file: '📁',
  link: '🔗',
  voice: '🎤',
  note: '📝',
};

const CaptureCard = ({ capture, onPress, onLongPress }) => {
  const icon = TYPE_ICONS[capture.type] || '●';
  const isEphemeral = capture.lane === 'ephemeral';
  const isImage = capture.format === 'image' || capture.type === 'photo' || !!capture.thumbnail_b64;
  const ts = new Date(capture.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateStr = new Date(capture.timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

  const preview = capture.type === 'clipboard' && capture.format !== 'image'
    ? (capture.content || '').substring(0, 120)
    : capture.filename || capture.content || '';

  const tags = (() => {
    try { return JSON.parse(capture.tags || '[]'); } catch { return []; }
  })();

  // Build image URI from base64 thumbnail or file path
  const imageUri = capture.thumbnail_b64
    ? `data:image/jpeg;base64,${capture.thumbnail_b64}`
    : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(capture)}
      onLongPress={() => onLongPress?.(capture)}
      activeOpacity={0.7}
    >
      <View style={styles.iconCol}>
        <Text style={styles.icon}>{icon}</Text>
        <View style={[
          styles.laneDot,
          { backgroundColor: isEphemeral ? colors.ephemeral : colors.persistent }
        ]} />
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.typeLabel}>{capture.type.toUpperCase()}</Text>
          <Text style={styles.source}>
            {capture.source === 'pc' ? '🖥 PC' : '📱 PHONE'}
          </Text>
        </View>

        {/* Image thumbnail */}
        {isImage && imageUri ? (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: imageUri }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
            {capture.file_size ? (
              <View style={styles.imageBadge}>
                <Text style={styles.imageBadgeText}>
                  {capture.file_size > 1048576
                    ? `${(capture.file_size / 1048576).toFixed(1)}MB`
                    : `${(capture.file_size / 1024).toFixed(0)}KB`}
                </Text>
              </View>
            ) : null}
          </View>
        ) : isImage && !imageUri ? (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderIcon}>🖼️</Text>
            <Text style={styles.imagePlaceholderText}>
              {capture.filename || 'Image'}
            </Text>
          </View>
        ) : (
          <Text style={styles.preview} numberOfLines={2}>{preview}</Text>
        )}

        <View style={styles.bottomRow}>
          <Text style={styles.timestamp}>{dateStr} {ts}</Text>
          {capture.file_size && !isImage ? (
            <Text style={styles.fileSize}>
              {capture.file_size > 1048576
                ? `${(capture.file_size / 1048576).toFixed(1)}MB`
                : `${(capture.file_size / 1024).toFixed(0)}KB`}
            </Text>
          ) : null}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.slice(0, 2).map((t, i) => (
                <View key={i} style={styles.tagBadge}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.obsidianLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  iconCol: {
    alignItems: 'center',
    marginRight: spacing.md,
    width: 32,
  },
  icon: {
    fontSize: 22,
  },
  laneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  typeLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: colors.gold,
  },
  source: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textDim,
  },
  preview: {
    fontFamily: 'System',
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
    marginBottom: 6,
  },
  // Image thumbnail styles
  imageContainer: {
    marginBottom: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: 160,
    borderRadius: radius.sm,
    backgroundColor: colors.obsidianMid,
  },
  imageBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(10, 10, 12, 0.75)',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageBadgeText: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.text,
  },
  imagePlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.obsidianMid,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: 6,
  },
  imagePlaceholderIcon: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  imagePlaceholderText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textDim,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timestamp: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textDim,
    marginRight: spacing.sm,
  },
  fileSize: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textFaint,
    marginRight: spacing.sm,
  },
  tagsRow: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'flex-end',
  },
  tagBadge: {
    backgroundColor: colors.goldGlow,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  tagText: {
    fontFamily: fonts.mono,
    fontSize: 7,
    letterSpacing: 1,
    color: colors.gold,
  },
});

export default CaptureCard;
