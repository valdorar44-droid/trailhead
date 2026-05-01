import { requireOptionalNativeModule } from 'expo-modules-core';

type ValhallaRoutingModule = {
  route(packPath: string, requestJson: string): Promise<string>;
  diagnose(packPath: string, requestJson: string): Promise<string>;
};

const NativeValhallaRouting = requireOptionalNativeModule<ValhallaRoutingModule>('ValhallaRoutingModule');

export function routeValhalla(packPath: string, requestJson: string): Promise<string> {
  if (!NativeValhallaRouting) {
    return Promise.reject(new Error('ValhallaRoutingModule is not linked in this binary'));
  }
  return NativeValhallaRouting.route(packPath, requestJson);
}

export function diagnoseValhalla(packPath: string, requestJson: string): Promise<string> {
  if (!NativeValhallaRouting || typeof NativeValhallaRouting.diagnose !== 'function') {
    return Promise.resolve('native-diag: diagnose is not linked in this binary');
  }
  return NativeValhallaRouting.diagnose(packPath, requestJson);
}
