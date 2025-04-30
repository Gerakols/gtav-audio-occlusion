import { ipcMain, Event } from 'electron';
import path from 'path';

import { err, isErr, ok, unwrapResult } from '@/electron/common';

import { ProjectAPI } from '@/electron/common/types/project';
import type { CreateProjectDTO } from '@/electron/common/types/project';
import type { CreateInteriorDTO } from '@/electron/common/types/interior';

import { isXMLFilePath, isMapDataFilePath, isMapTypesFilePath } from '@/electron/common/utils/files';

import { Ymap, Ytyp } from '@/core/types/xml';
import { getCMloInstanceDef } from '@/core/game';

import { Application } from './app';

import { Project } from './project';
import { Interior } from './interior';

import { forwardSerializedResult, sanitizePath, selectDirectory, selectFiles } from './utils';

const MAP_DATA_FILE_FILTERS = [{ name: '#map files', extensions: ['ymap.xml'] }];
const MAP_TYPES_FILE_FILTERS = [{ name: '#typ files', extensions: ['ytyp.xml'] }];

export class ProjectManager {
  private application: Application;

  public currentProject: Project | null;

  constructor(application: Application) {
    this.application = application;

    this.currentProject = null;

    ipcMain.handle(ProjectAPI.CREATE_PROJECT, this.createProject.bind(this));
    ipcMain.handle(ProjectAPI.GET_CURRENT_PROJECT, () => forwardSerializedResult(this.getCurrentProject()));
    ipcMain.handle(ProjectAPI.CLOSE_PROJECT, this.closeProject.bind(this));
    ipcMain.handle(ProjectAPI.SELECT_PROJECT_PATH, this.selectProjectPath.bind(this));
    ipcMain.handle(ProjectAPI.SELECT_MAP_DATA_FILE, this.selectMapDataFile.bind(this));
    ipcMain.handle(ProjectAPI.SELECT_MAP_TYPES_FILE, this.selectMapTypesFile.bind(this));
    ipcMain.handle(ProjectAPI.WRITE_GENERATED_FILES, this.writeGeneratedFiles.bind(this));
    ipcMain.handle(ProjectAPI.ADD_INTERIOR, this.addInteriorToExistingProject.bind(this));
  }

  public getCurrentProject(): Result<string, Project> {
    return ok(this.currentProject);
  }

  public async selectProjectPath(): Promise<Result<string, string>> {
    const [directoryPath] = await selectDirectory();

    return ok(directoryPath);
  }

  public async selectMapDataFile(): Promise<Result<string, string>> {
    const filePaths = await selectFiles(MAP_DATA_FILE_FILTERS);

    const filteredPaths = filePaths.filter(isXMLFilePath);

    const mapDataFilePath = filteredPaths.find(isMapDataFilePath);

    if (!mapDataFilePath) {
      return err('INVALID_FILE');
    }

    return ok(mapDataFilePath);
  }

  public async selectMapTypesFile(): Promise<Result<string, string>> {
    const filePaths = await selectFiles(MAP_TYPES_FILE_FILTERS);

    const filteredPaths = filePaths.filter(isXMLFilePath);

    const mapTypesFilePath = filteredPaths.find(isMapTypesFilePath);

    if (!mapTypesFilePath) {
      return err('INVALID_FILE');
    }

    return ok(mapTypesFilePath);
  }

  public async addInteriorToProject(
    project: Project,
    { name, mapDataFilePath, mapTypesFilePath }: CreateInteriorDTO,
  ): Promise<Result<string, boolean>> {
    let mapDataFile: Ymap;
    let mapTypesFile: Ytyp;

    try {
      mapDataFile = await this.application.codeWalkerFormat.readFile<Ymap>(mapDataFilePath);
    } catch {
      return err('FAILED_READING_#MAP_FILE');
    }

    try {
      mapTypesFile = await this.application.codeWalkerFormat.readFile<Ytyp>(mapTypesFilePath);
    } catch {
      return err('FAILED_READING_#TYP_FILE');
    }

    const mapData = this.application.codeWalkerFormat.parseCMapData(mapDataFile);
    const mapTypes = this.application.codeWalkerFormat.parseCMapTypes(mapTypesFile);

    const mloInstance = getCMloInstanceDef(mapData, mapTypes);

    if (!mloInstance) {
      return err('C_MLO_INSTANCE_DEF_NOT_FOUND');
    }

    const interiorPath = path.resolve(project.path, sanitizePath(name));

    const interior = new Interior({
      identifier: name,
      path: interiorPath,
      mapDataFilePath,
      mapTypesFilePath,
      mapData,
      mapTypes,
      mloInstance,
    });

    project.addInterior(interior);

    return ok(true);
  }

  public async addInteriorToExistingProject(_: Event, interior: CreateInteriorDTO): Promise<Result<string, boolean>> {
    if (!this.currentProject) {
      return err('NO_PROJECT_OPEN');
    }

    return this.addInteriorToProject(this.currentProject, interior);
  }

  public async createProject(_: Event, { name, path, interior }: CreateProjectDTO): Promise<Result<string, boolean>> {
    this.currentProject = new Project({ name, path });

    const result = await this.addInteriorToProject(this.currentProject, interior);

    if (isErr(result)) {
      return result;
    }

    return ok(true);
  }

  public closeProject(): Result<string, boolean> {
    this.currentProject = null;

    return ok(true);
  }

  public async writeInteriorsOcclusionMetadata(): Promise<Result<string, boolean>> {
    const projectResult = this.application.projectManager.getCurrentProject();

    if (isErr(projectResult)) {
      return projectResult;
    }

    const project = unwrapResult(projectResult);

    for (const interior of project.interiors) {
      const { naOcclusionInteriorMetadata, path } = interior;

      naOcclusionInteriorMetadata.refresh();

      let filePath: string;

      try {
        filePath = await this.application.codeWalkerFormat.writeNaOcclusionInteriorMetadata(
          path,
          naOcclusionInteriorMetadata,
          this.application.settings.writeDebugInfoToXML,
        );
      } catch {
        return err('FAILED_TO_WRITE_NA_OCCLUSION_INTERIOR_METADATA_FILE');
      }

      interior.naOcclusionInteriorMetadataPath = filePath;
    }

    return ok(true);
  }

  public async writeDat151(): Promise<Result<string, string>> {
    const projectResult = this.application.projectManager.getCurrentProject();

    if (isErr(projectResult)) {
      return projectResult;
    }

    const project = unwrapResult(projectResult);

    // Группировка интерьеров по ytyp файлам
    const interiorsByTyp: { [ytypPath: string]: Interior[] } = {};
    
    project.interiors.forEach(interior => {
      if (!interiorsByTyp[interior.mapTypesFilePath]) {
        interiorsByTyp[interior.mapTypesFilePath] = [];
      }
      interiorsByTyp[interior.mapTypesFilePath].push(interior);
    });

    // Генерация отдельного dat151 файла для каждой группы интерьеров с одинаковым ytyp
    const generatedFiles: string[] = [];
    
    for (const ytypPath in interiorsByTyp) {
      const interiors = interiorsByTyp[ytypPath];
      
      // Для каждого ytyp берем только данные из первого интерьера
      // Это исключает дублирование данных лимбо и румов
      const firstInterior = interiors[0];
      const audioGameData = firstInterior.getAudioGameData();
      
      // Создаем уникальное имя папки на основе имени ytyp файла (без пути и расширения)
      const ytypFileName = path.basename(ytypPath, '.ytyp.xml');
      const outputDir = path.resolve(project.path, sanitizePath(ytypFileName));
      
      // Создаем директорию, если она не существует
      try {
        const fs = require('fs');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
      } catch {
        return err('FAILED_TO_CREATE_OUTPUT_DIRECTORY');
      }
      
      try {
        let filePath = await this.application.codeWalkerFormat.writeDat151(outputDir, audioGameData);
        generatedFiles.push(filePath);
        
        // Обновляем путь к аудио файлу для каждого интерьера в этой группе
        interiors.forEach(interior => {
          interior.audioGameDataPath = filePath;
        });
      } catch {
        return err('FAILED_TO_WRITE_DAT_151_FILE');
      }
    }

    return ok(generatedFiles.join(', '));
  }

  public async writeGeneratedFiles(): Promise<Result<string, boolean>> {
    const [interiorsMetadataResult, dat151Result] = await Promise.all([
      this.writeInteriorsOcclusionMetadata(),
      this.writeDat151(),
    ]);

    if (isErr(interiorsMetadataResult)) {
      return interiorsMetadataResult;
    }

    if (isErr(dat151Result)) {
      return dat151Result;
    }

    return ok(true);
  }
}
