import { AppState } from 'react-native';
import type { MeshPort } from '../mesh/types';

/**
 * SDK_INTEGRATION.md section 8, step 5: on every foreground transition reconcile with the SDK
 * (it may have been stopped from the Android notification, or by the OS). Returns an unbind.
 */
export function bindMeshToAppState(mesh: MeshPort): () => void {
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active') {
      void mesh.reconcile();
    }
  });
  return () => sub.remove();
}
