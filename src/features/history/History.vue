<template>
  <div class="aside-block">
    <el-table :data="tableData" class="table-block">
      <el-table-column label="Work" width="180">
        <template #default="scope">
          <el-popover effect="light" trigger="hover" placement="top" width="auto">
            <template #default>
              <div>work: {{ scope.row.work }}</div>
              <div>time: {{ scope.row.date }}</div>
            </template>
            <template #reference>
              <el-tag>{{
                scope.row.work.length > 12
                  ? scope.row.work.slice(0, 12) + '...'
                  : scope.row.work
              }}</el-tag>
            </template>
          </el-popover>
        </template>
      </el-table-column>
      <el-table-column label="Operations" class="oper-btn">
        <template #default="scope">
          <el-button size="small" @click="handleEdit(scope.$index, scope.row)">
            Edit
          </el-button>
          <el-button size="small" type="danger" @click="handleDelete(scope.$index, scope.row)" id="delete-btn">
            Delete
          </el-button>
          <div v-if="isRowEditing(scope.$index)">
            <el-input v-model="scope.row.work" class="input-block" :autosize="{ minRows: 1, maxRows: 3 }"
              type="textarea" style="font-size: 12px" />
            <el-button size="small" type="primary" @click="handleEdit(scope.$index, scope.row)">Save</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script lang="ts" setup>

import { ref } from 'vue';
import { useChat } from '../../hooks/useChat'
import type { User } from '../../types/User'

const { tableData,
  saveDataToLocalStorage,
} = useChat();


const isEditing = ref<number | null>(null);
const isRowEditing = (index: number) => isEditing.value === index;


// 处理编辑按钮点击事件
const handleEdit = (index: number, row: User) => {
  if (isEditing.value === index) {
    // 如果当前行已经处于编辑状态，保存编辑内容
    row.work = row.work.substring(0, 10);
    row.date = new Date().toISOString(); // 更新当前时间
    isEditing.value = null; // 退出编辑模式
    saveDataToLocalStorage(); // 保存数据
  } else {
    // 如果当前行没有处于编辑状态，进入编辑模式
    isEditing.value = index;
  }
};

// 处理删除操作
const handleDelete = (index: number, row: User) => {
  if (index >= 0 && index < tableData.value.length) {
    tableData.value.splice(index, 1); // 删除指定行
    saveDataToLocalStorage(); // 删除后保存数据
  } else {
    console.error('Invalid index for delete operation');
  }
};
</script>

<style>
.aside-block {
  height: 100%;
  width: 300px;
  overflow-y: auto;
  border-right: 1px solid #e4e7ed;
}

.oper-btn {
  position: relative;
}

.input-block {
  height: 80%;
  font-size: 18px;
  border-radius: 20px;
}

.el-tag {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  display: inline-flex !important;
  align-items: center;
  height: 32px;
  line-height: normal !important;
  vertical-align: middle !important;
}

.el-tag__content {
  padding: 0px 12px 0px 0px;
}

.el-tag .delete-icon {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  line-height: 1;
  transition: all 0.2s;
}

.delete-icon:hover {
  color: #f56c6c;
  transform: translateY(-50%) scale(1.5);
}

#delete-btn {
  position: absolute;
  width: 40%;
}
</style>
