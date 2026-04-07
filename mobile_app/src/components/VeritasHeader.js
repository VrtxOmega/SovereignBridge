/**
 * VERITAS Shield Header Component
 * ================================
 * Gold shield with connection status indicator.
 * Used at the top of every Bridge screen.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fonts } from '../theme/veritas';

const VeritasHeader = ({ title = 'SOVEREIGN BRIDGE', connected = false, subtitle }) => {
  return (
    <View style={styles.container}>
      <View style={styles.shieldRow}>
        {/* VERITAS Shield */}
        <View style={styles.shield}>
          <View style={styles.shieldOuter}>
            <View style={styles.shieldInner}>
              <Text style={styles.omega}>V</Text>
            </View>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle}>{subtitle}</Text>
          ) : (
            <Text style={styles.motto}>EXAMINA OMNIA</Text>
          )}
        </View>

        {/* Connection indicator */}
        <View style={styles.statusBlock}>
          <View style={[styles.statusDot, { backgroundColor: connected ? colors.green : colors.red }]} />
          <Text style={styles.statusText}>
            {connected ? 'LINKED' : 'OFFLINE'}
          </Text>
        </View>
      </View>

      {/* Gold separator line */}
      <View style={styles.separator} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.obsidianDeep,
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: spacing.lg,
  },
  shieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shield: {
    marginRight: spacing.md,
  },
  shieldOuter: {
    width: 38,
    height: 44,
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 4,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.06)',
  },
  shieldInner: {
    width: 28,
    height: 32,
    borderWidth: 0.8,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: 2,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  omega: {
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.gold,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 4,
    color: colors.gold,
    fontWeight: 'bold',
  },
  motto: {
    fontFamily: fonts.mono,
    fontSize: 7,
    letterSpacing: 3,
    color: colors.goldDim,
    marginTop: 2,
  },
  subtitle: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    color: colors.textDim,
    marginTop: 2,
  },
  statusBlock: {
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 3,
  },
  statusText: {
    fontFamily: fonts.mono,
    fontSize: 7,
    letterSpacing: 2,
    color: colors.textDim,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
});

export default VeritasHeader;
