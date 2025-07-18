import { spawn, exec } from 'child_process'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import path from 'path'
import { controlWindow } from '../ControlWindow'
import { allConfig } from './AllConfig'
import { i18n } from '../i18n'

export class CaptionEngine {
  appPath: string = ''
  command: string[] = []
  process: any | undefined
  processStatus: 'running' | 'stopping' | 'stopped' = 'stopped'

  private getApp(): boolean {
    allConfig.controls.customized = false
    if (allConfig.controls.customized && allConfig.controls.customizedApp) {
      this.appPath = allConfig.controls.customizedApp
      this.command = [allConfig.controls.customizedCommand]
      allConfig.controls.customized = true
    }
    else if (allConfig.controls.engine === 'gummy') {
      if(!allConfig.controls.API_KEY && !process.env.DASHSCOPE_API_KEY) {
        controlWindow.sendErrorMessage(i18n('gummy.key.missing'))
        return false
      }
      let gummyName = 'main-gummy'
      if (process.platform === 'win32') {
        gummyName += '.exe'
      }
      if (is.dev) {
        this.appPath = path.join(
          app.getAppPath(),
          'caption-engine', 'dist', gummyName
        )
      }
      else {
        this.appPath = path.join(
          process.resourcesPath, 'caption-engine', gummyName
        )
      }
      this.command = []
      this.command.push('-s', allConfig.controls.sourceLang)
      this.command.push(
        '-t', allConfig.controls.translation ?
        allConfig.controls.targetLang : 'none'
      )
      this.command.push('-a', allConfig.controls.audio ? '1' : '0')
      if(allConfig.controls.API_KEY) {
        this.command.push('-k', allConfig.controls.API_KEY)
      }
    }
    else if(allConfig.controls.engine === 'vosk'){
      let voskName = 'main-vosk'
      if (process.platform === 'win32') {
        voskName += '.exe'
      }
      if (is.dev) {
        this.appPath = path.join(
          app.getAppPath(),
          'caption-engine', 'dist', voskName
        )
      }
      else {
        this.appPath = path.join(
          process.resourcesPath, 'caption-engine', voskName
        )
      }
      this.command = []
      this.command.push('-a', allConfig.controls.audio ? '1' : '0')
      this.command.push('-m', `"${allConfig.controls.modelPath}"`)
    }
    console.log('[INFO] Engine Path:', this.appPath)
    console.log('[INFO] Engine Command:', this.command)
    return true
  }

  public start() {
    if (this.processStatus !== 'stopped') {
      return
    }
    if(!this.getApp()){ return }

    try {
      this.process = spawn(this.appPath, this.command)
    }
    catch (e) {
      controlWindow.sendErrorMessage(i18n('engine.start.error') + e)
      console.error('[ERROR] Error starting subprocess:', e)
      return
    }

    this.processStatus = 'running'
    console.log('[INFO] Caption Engine Started, PID:', this.process.pid)

    allConfig.controls.engineEnabled = true
    if(controlWindow.window){
      allConfig.sendControls(controlWindow.window)
      controlWindow.window.webContents.send(
        'control.engine.started',
        this.process.pid
      )
    }

    this.process.stdout.on('data', (data: any) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          try {
            const caption = JSON.parse(line);
            allConfig.updateCaptionLog(caption);
          } catch (e) {
            controlWindow.sendErrorMessage(i18n('engine.output.parse.error') + e)
            console.error('[ERROR] Error parsing JSON:', e);
          }
        }
      });
    });

    this.process.stderr.on('data', (data) => {
      if(this.processStatus === 'stopping') return
      controlWindow.sendErrorMessage(i18n('engine.error') + data)
      console.error(`[ERROR] Subprocess Error: ${data}`);
    });

    this.process.on('close', (code: any) => {
      console.log(`[INFO] Subprocess exited with code ${code}`);
      this.process = undefined;
      allConfig.controls.engineEnabled = false
      if(controlWindow.window){
        allConfig.sendControls(controlWindow.window)
        controlWindow.window.webContents.send('control.engine.stopped')
      }
      this.processStatus = 'stopped'
      console.log('[INFO] Caption engine process stopped')
    });
  }

  public stop() {
    if(this.processStatus !== 'running') return
    if (this.process.pid) {
      console.log('[INFO] Trying to stop process, PID:', this.process.pid)
      let cmd = `kill ${this.process.pid}`;
      if (process.platform === "win32") {
        cmd = `taskkill /pid ${this.process.pid} /t /f`
      }
      exec(cmd, (error) => {
        if (error) {
          controlWindow.sendErrorMessage(i18n('engine.shutdown.error') + error)
          console.error(`[ERROR] Failed to kill process: ${error}`)
        }
      })
    }
    else {
      this.process = undefined;
      allConfig.controls.engineEnabled = false
      if(controlWindow.window){
        allConfig.sendControls(controlWindow.window)
        controlWindow.window.webContents.send('control.engine.stopped')
      }
      this.processStatus = 'stopped'
      console.log('[INFO] Process PID undefined, caption engine process stopped')
      return
    }
    this.processStatus = 'stopping'
    console.log('[INFO] Caption engine process stopping')
  }
}

export const captionEngine = new CaptionEngine()
