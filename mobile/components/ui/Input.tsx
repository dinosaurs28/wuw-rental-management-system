import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, TouchableOpacity } from 'react-native';
import { Controller, Control, FieldValues, Path } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../constants/colors';

interface InputProps<T extends FieldValues> extends TextInputProps {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  error?: string;
}

export default function Input<T extends FieldValues>({
  control,
  name,
  label,
  error,
  secureTextEntry,
  ...inputProps
}: InputProps<T>) {
  const [hidden, setHidden] = useState(true);
  const isPassword = !!secureTextEntry;

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <View style={[styles.inputRow, error ? styles.inputError : null]}>
            <TextInput
              style={styles.input}
              onChangeText={onChange}
              onBlur={onBlur}
              value={value}
              placeholderTextColor={Colors.ink4}
              secureTextEntry={isPassword && hidden}
              {...inputProps}
            />
            {isPassword && (
              <TouchableOpacity
                onPress={() => setHidden((h) => !h)}
                style={styles.eyeBtn}
                hitSlop={8}
              >
                <Ionicons
                  name={hidden ? 'eye-outline' : 'eye-off-outline'}
                  size={20}
                  color={Colors.ink3}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
    letterSpacing: 0.2,
  },
  inputRow: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  eyeBtn: { paddingHorizontal: 14 },
  inputError: { borderColor: '#e53e3e' },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: '#e53e3e',
  },
});
