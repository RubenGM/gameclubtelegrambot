export function shouldDetachDebianTrayProcess(env: NodeJS.ProcessEnv): boolean {
  return env.GAMECLUB_TRAY_FOREGROUND !== '1' && env.GAMECLUB_TRAY_CHILD !== '1';
}
